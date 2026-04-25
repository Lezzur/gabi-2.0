"use client"

import { useRef, useState, useCallback, Fragment } from "react"
import type { ChangeEvent, DragEvent } from "react"
import {
  Leaf,
  Upload,
  CheckCircle2,
  AlertCircle,
  Download,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

type Stage = "idle" | "selected" | "uploading" | "processing" | "done"

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 5 * 1024 * 1024
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_KEY = (hash: string) => `fpa_import_${hash}`

// ─── Idempotency cache (sessionStorage) ──────────────────────────────────────

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

function readCache(hash: string): ImportResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY(hash))
    if (!raw) return null
    const { result, expiresAt } = JSON.parse(raw) as {
      result: ImportResult
      expiresAt: number
    }
    if (Date.now() > expiresAt) {
      sessionStorage.removeItem(CACHE_KEY(hash))
      return null
    }
    return result
  } catch {
    return null
  }
}

function writeCache(hash: string, result: ImportResult): void {
  try {
    sessionStorage.setItem(
      CACHE_KEY(hash),
      JSON.stringify({ result, expiresAt: Date.now() + CACHE_TTL_MS }),
    )
  } catch {
    // sessionStorage unavailable — silently skip caching
  }
}

// ─── CSV download ─────────────────────────────────────────────────────────────

function downloadErrorCsv(errors: ImportResult["errors"]): void {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = [
    ["Row", "Reason"].map(escape).join(","),
    ...errors.map(e => [String(e.row), e.reason].map(escape).join(",")),
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "fpa-import-errors.csv"
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FpaImportPage() {
  const [stage, setStage] = useState<Stage>("idle")
  const [file, setFile] = useState<File | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── File selection ──────────────────────────────────────────────────────────

  function validateAndSelect(f: File): void {
    const ext = f.name.split(".").pop()?.toLowerCase()
    if (ext !== "xlsx") {
      toast.error("Only .xlsx files are accepted")
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error("File too large — maximum is 5 MB")
      return
    }
    setFile(f)
    setResult(null)
    setStage("selected")
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (f) validateAndSelect(f)
    e.target.value = ""
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) validateAndSelect(f)
  }

  function reset(): void {
    setStage("idle")
    setFile(null)
    setUploadPct(0)
    setResult(null)
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!file) return

    // Check idempotency cache
    const hash = await hashFile(file)
    const cached = readCache(hash)
    if (cached) {
      setResult(cached)
      setStage("done")
      toast.success("Loaded from cache — same file within 5 minutes")
      return
    }

    const formData = new FormData()
    formData.append("file", file)

    setStage("uploading")
    setUploadPct(0)

    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setUploadPct(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.upload.addEventListener("load", () => {
      setStage("processing")
    })

    xhr.addEventListener("load", () => {
      if (xhr.status === 413) {
        toast.error("File too large — server rejected the upload")
        setStage("selected")
        return
      }

      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        toast.error("Unexpected server response")
        setStage("selected")
        return
      }

      if (xhr.status >= 400) {
        const errBody = body as { error?: { message?: string } | string }
        const msg =
          typeof errBody.error === "object"
            ? errBody.error?.message
            : typeof errBody.error === "string"
              ? errBody.error
              : "Import failed"
        toast.error(msg ?? "Import failed")
        setStage("selected")
        return
      }

      const data = (body as { data: ImportResult }).data
      writeCache(hash, data)
      setResult(data)
      setStage("done")
    })

    xhr.addEventListener("error", () => {
      toast.error("Network error — please try again")
      setStage("selected")
    })

    xhr.open("POST", "/api/products/import-fpa")
    xhr.send(formData)
  }, [file])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          FPA Import
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the FPA Excel spreadsheet to sync registered product data.
        </p>
      </div>

      {/* ── Upload zone (idle) ── */}
      {stage === "idle" && (
        <Card>
          <CardContent className="pt-6">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e: DragEvent<HTMLDivElement>) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg",
                "border-2 border-dashed p-12 transition-colors select-none",
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/40",
              )}
            >
              <Leaf className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  Drag .xlsx here or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  xlsx only · max 5 MB
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={handleInputChange}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── File selected ── */}
      {stage === "selected" && file && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Leaf className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                onClick={reset}
                aria-label="Remove file"
                className="ml-3 shrink-0 rounded p-1 transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <Button onClick={handleImport} className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Upload progress ── */}
      {stage === "uploading" && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <StageBar current={1} />
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Uploading {file?.name}
                </span>
                <span className="tabular-nums font-medium">{uploadPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Processing (server parsing + importing) ── */}
      {stage === "processing" && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <StageBar current={2} />
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Processing spreadsheet…
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-full rounded-full bg-primary animate-pulse" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Results ── */}
      {stage === "done" && result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Import complete
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryTile
                  label="Inserted"
                  value={result.inserted}
                  color="green"
                />
                <SummaryTile
                  label="Updated"
                  value={result.updated}
                  color="green"
                />
                <SummaryTile
                  label="Skipped"
                  value={result.skipped}
                  color="neutral"
                />
                <SummaryTile
                  label="Errors"
                  value={result.errors.length}
                  color={result.errors.length > 0 ? "red" : "neutral"}
                />
              </dl>
            </CardContent>
          </Card>

          {result.errors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Row errors ({result.errors.length})
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadErrorCsv(result.errors)}
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Download CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">
                            {err.row}
                          </TableCell>
                          <TableCell className="text-sm text-destructive">
                            {err.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Button variant="outline" onClick={reset} className="w-full">
            Import another file
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const STAGES = ["Uploading", "Parsing", "Importing", "Done"] as const

function StageBar({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex items-center">
      {STAGES.map((label, i) => {
        const step = (i + 1) as 1 | 2 | 3 | 4
        const done = step < current
        const active = step === current
        return (
          <Fragment key={label}>
            <div className="flex shrink-0 items-center gap-1.5">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-accent text-accent-foreground",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? "✓" : step}
              </div>
              <span
                className={cn(
                  "text-xs",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-px flex-1",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: "green" | "neutral" | "red"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-center",
        color === "green" &&
          "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40",
        color === "red" &&
          "border-destructive/30 bg-destructive/5",
        color === "neutral" && "border-border bg-muted/30",
      )}
    >
      <dd
        className={cn(
          "text-2xl font-bold tabular-nums",
          color === "green" && "text-green-700 dark:text-green-400",
          color === "red" && "text-destructive",
          color === "neutral" && "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </dd>
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}
