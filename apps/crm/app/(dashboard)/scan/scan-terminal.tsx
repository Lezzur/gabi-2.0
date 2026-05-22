"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { ReturnConfirmDialog } from "./return-confirm-dialog"

// ─── Types ─────────────────────────────────────────────────────────────────

type ScanStep = "purchase_dealer" | "return_dealer"

interface ScanHistoryEntry {
  id: string
  uuid: string
  step: ScanStep
  outcome: "success" | "error"
  code: string
  message: string
  ts: string
}

interface PendingScan {
  uuid: string
  hmac: string
  step: ScanStep
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseQrPayload(raw: string): { uuid: string; hmac: string } | null {
  // Expected format: gaia.ph/scan/<uuid>.<16-hex-hmac>
  const match = raw.match(/\/scan\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{16})$/i)
  if (!match) return null
  return { uuid: match[1]!, hmac: match[2]! }
}

function outcomeLabel(code: string): string {
  const map: Record<string, string> = {
    success: "Accepted",
    ALREADY_CLAIMED: "Already claimed",
    INVALID_HMAC: "Invalid QR code",
    RATE_LIMITED: "Too many attempts",
    WINDOW_EXPIRED: "Window expired",
    AUTH_REQUIRED: "Not signed in",
    FORBIDDEN: "Access denied",
    INTERNAL_ERROR: "Server error",
  }
  return map[code] ?? code
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ScanTerminal() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastScanRef = useRef<{ uuid: string; ts: number } | null>(null)

  const [step, setStep] = useState<ScanStep>("purchase_dealer")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [history, setHistory] = useState<ScanHistoryEntry[]>([])
  const [pending, setPending] = useState<PendingScan | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ── Camera init ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return

    if (!("BarcodeDetector" in window)) {
      setCameraError(
        "QR scanning requires Chrome or Edge 90+. Please use a supported browser on this device.",
      )
      return
    }

    let stream: MediaStream | null = null

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        detectorRef.current = new (window as unknown as { BarcodeDetector: typeof BarcodeDetector }).BarcodeDetector({
          formats: ["qr_code"],
        })
        setScanning(true)
      } catch (err) {
        const msg = err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access was denied. Enable camera permission in your browser settings and reload."
          : `Camera error: ${err instanceof Error ? err.message : String(err)}`
        setCameraError(msg)
      }
    }

    startCamera()

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      stream?.getTracks().forEach((t) => t.stop())
      setScanning(false)
    }
  }, [])

  // ── Scan loop ────────────────────────────────────────────────────────────
  const currentStep = useRef(step)
  currentStep.current = step

  const tick = useCallback(async () => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    try {
      const codes = await detector.detect(video)
      for (const code of codes) {
        const parsed = parseQrPayload(code.rawValue)
        if (!parsed) continue

        // Debounce: same UUID within 2 s
        const now = Date.now()
        if (lastScanRef.current?.uuid === parsed.uuid && now - lastScanRef.current.ts < 2000) {
          break
        }
        lastScanRef.current = { uuid: parsed.uuid, ts: now }

        if (currentStep.current === "return_dealer") {
          setPending({ ...parsed, step: currentStep.current })
        } else {
          await submitScan(parsed.uuid, parsed.hmac, currentStep.current)
        }
        break
      }
    } catch {
      // BarcodeDetector can throw on certain frames — continue scanning
    }

    rafRef.current = requestAnimationFrame(tick)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scanning) return
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scanning, tick])

  // ── Submit scan ──────────────────────────────────────────────────────────
  async function submitScan(uuid: string, hmac: string, scanStep: ScanStep) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uuid,
          hmac,
          step: scanStep,
          actor_type: "dealer",
          local_scan_ts: new Date().toISOString(),
        }),
      })

      const json = (await res.json()) as { data?: { outcome?: string }; error?: { code?: string; message?: string } }

      const entry: ScanHistoryEntry = {
        id: crypto.randomUUID(),
        uuid,
        step: scanStep,
        outcome: res.ok ? "success" : "error",
        code: res.ok ? "success" : (json.error?.code ?? "ERROR"),
        message: res.ok
          ? scanStep === "purchase_dealer" ? "Purchase initiated" : "Return accepted"
          : outcomeLabel(json.error?.code ?? ""),
        ts: new Date().toLocaleTimeString(),
      }

      setHistory((h) => [entry, ...h].slice(0, 10))
    } catch {
      setHistory((h) => [
        {
          id: crypto.randomUUID(),
          uuid,
          step: scanStep,
          outcome: "error" as const,
          code: "NETWORK_ERROR",
          message: "Network error — check connection",
          ts: new Date().toLocaleTimeString(),
        },
        ...h,
      ].slice(0, 10))
    } finally {
      setSubmitting(false)
      setPending(null)
    }
  }

  // ── Return dialog handlers ────────────────────────────────────────────────
  function handleReturnConfirm() {
    if (!pending) return
    submitScan(pending.uuid, pending.hmac, pending.step)
  }

  function handleReturnCancel() {
    setPending(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 h-full">
      {/* Camera + tabs */}
      <div className="flex-1 flex flex-col gap-4">
        <Tabs value={step} onValueChange={(v) => setStep(v as ScanStep)}>
          <TabsList className="w-full">
            <TabsTrigger value="purchase_dealer" className="flex-1">
              Purchase
            </TabsTrigger>
            <TabsTrigger value="return_dealer" className="flex-1">
              Return
            </TabsTrigger>
          </TabsList>

          <TabsContent value="purchase_dealer">
            <p className="text-sm text-muted-foreground">
              Scan the container QR code to initiate a farmer purchase.
            </p>
          </TabsContent>
          <TabsContent value="return_dealer">
            <p className="text-sm text-muted-foreground">
              Scan the container QR code to accept a return. A condition check is required.
            </p>
          </TabsContent>
        </Tabs>

        <Card className="flex-1 overflow-hidden">
          <CardContent className="p-0 relative h-80">
            {cameraError ? (
              <div className="h-full flex items-center justify-center p-6 text-center">
                <p className="text-sm text-destructive">{cameraError}</p>
              </div>
            ) : (
              <>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                  aria-label="Camera feed for QR scanning"
                />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-52 h-52 border-2 border-white/70 rounded-lg" />
                </div>
                {submitting && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">Processing…</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Hold the QR code steady in the frame. Scans are processed automatically.
        </p>
      </div>

      <Separator orientation="vertical" />

      {/* History panel */}
      <div className="w-72 flex flex-col gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent Scans</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">No scans yet.</p>
            ) : (
              <ul className="divide-y">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 px-4 py-2">
                    <Badge
                      variant={entry.outcome === "success" ? "default" : "destructive"}
                      className="mt-0.5 shrink-0"
                    >
                      {entry.outcome === "success" ? "OK" : "ERR"}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{entry.message}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {entry.uuid.slice(0, 8)}… · {entry.ts}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setHistory([])}
          disabled={history.length === 0}
        >
          Clear history
        </Button>
      </div>

      {/* Return condition dialog */}
      <ReturnConfirmDialog
        open={pending !== null}
        containerUuid={pending?.uuid ?? ""}
        onConfirm={handleReturnConfirm}
        onCancel={handleReturnCancel}
      />
    </div>
  )
}
