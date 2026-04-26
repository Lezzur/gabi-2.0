"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Save, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"

// ─── Types ────────────────────────────────────────────────────────────────────

interface RewardConfig {
  farmer_points_per_return: number
  dealer_points_per_return: number
  updated_by: string | null
  updated_at: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RewardsSettingsPage() {
  const [config, setConfig] = useState<RewardConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Draft values (strings for controlled inputs)
  const [farmerPts, setFarmerPts] = useState("")
  const [dealerPts, setDealerPts] = useState("")

  // ── Fetch current config ────────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/reward-config")
      if (!res.ok) {
        toast.error("Failed to load reward config")
        return
      }
      const json = (await res.json()) as { data: RewardConfig }
      setConfig(json.data)
      setFarmerPts(String(json.data.farmer_points_per_return))
      setDealerPts(String(json.data.dealer_points_per_return))
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  // ── Validation ──────────────────────────────────────────────────────────────
  const farmerVal = parseInt(farmerPts, 10)
  const dealerVal = parseInt(dealerPts, 10)
  const isValid =
    !isNaN(farmerVal) && farmerVal >= 0 &&
    !isNaN(dealerVal) && dealerVal >= 0

  const isDirty =
    config !== null &&
    (farmerVal !== config.farmer_points_per_return ||
      dealerVal !== config.dealer_points_per_return)

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleConfirmSave = async () => {
    if (!isValid) return
    setSaving(true)
    setConfirmOpen(false)

    try {
      const res = await fetch("/api/reward-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          farmer_points_per_return: farmerVal,
          dealer_points_per_return: dealerVal,
        }),
      })

      if (res.status === 403) {
        toast.error("Admin access required to update reward config.")
        return
      }
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        toast.error(err.error?.message ?? "Failed to save reward config")
        return
      }

      const json = (await res.json()) as { data: RewardConfig }
      setConfig(json.data)
      setFarmerPts(String(json.data.farmer_points_per_return))
      setDealerPts(String(json.data.dealer_points_per_return))
      toast.success("Reward config updated successfully.")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Reward Config
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the points awarded per return and voucher denominations.
          Changes are logged to the audit trail.
        </p>
      </div>

      {/* ── Point values form ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Point Values per Return
          </CardTitle>
          <CardDescription>
            Points credited to farmers and dealers when a container return is
            processed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="farmer-pts">Farmer points per return</Label>
                <Input
                  id="farmer-pts"
                  type="number"
                  min={0}
                  step={1}
                  value={farmerPts}
                  onChange={e => setFarmerPts(e.target.value)}
                  className="max-w-xs tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dealer-pts">Dealer points per return</Label>
                <Input
                  id="dealer-pts"
                  type="number"
                  min={0}
                  step={1}
                  value={dealerPts}
                  onChange={e => setDealerPts(e.target.value)}
                  className="max-w-xs tabular-nums"
                />
              </div>

              {config && (
                <p className="text-xs text-muted-foreground">
                  Last updated: {new Date(config.updated_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}

              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!isValid || !isDirty || saving}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Voucher denominations (read-only) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voucher Denominations</CardTitle>
          <CardDescription>
            Available voucher face values (fixed — contact engineering to change).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {["PHP 50", "PHP 100", "PHP 200", "PHP 500"].map(d => (
              <span
                key={d}
                className="inline-flex items-center rounded-md border bg-muted/40 px-3 py-1 text-sm font-mono font-medium text-muted-foreground"
              >
                {d}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Confirmation dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm reward config change
            </DialogTitle>
            <DialogDescription>
              This will immediately affect point calculations for all future
              returns. The change will be recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          {config && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2 text-sm">
              <Separator className="my-2" />
              <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground font-medium uppercase tracking-wide">
                <span />
                <span className="text-center">Before</span>
                <span className="text-center">After</span>
              </div>
              <DiffRow
                label="Farmer pts"
                before={config.farmer_points_per_return}
                after={farmerVal}
              />
              <DiffRow
                label="Dealer pts"
                before={config.dealer_points_per_return}
                after={dealerVal}
              />
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={saving}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={() => void handleConfirmSave()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DiffRow({
  label,
  before,
  after,
}: {
  label: string
  before: number
  after: number
}) {
  const changed = before !== after
  return (
    <div className="grid grid-cols-3 gap-1 items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-center tabular-nums font-mono">{before}</span>
      <span
        className={
          changed
            ? "text-center tabular-nums font-mono font-semibold text-foreground"
            : "text-center tabular-nums font-mono text-muted-foreground"
        }
      >
        {after}
        {changed && (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
            ↑
          </span>
        )}
      </span>
    </div>
  )
}
