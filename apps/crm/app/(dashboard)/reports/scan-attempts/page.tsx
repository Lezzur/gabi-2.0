"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Download, Search, X, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanAttemptRow {
  id: string
  container_id: string | null
  actor_id: string
  actor_type: string
  step: string
  outcome: string
  hmac_valid: boolean
  auth_valid: boolean
  ip_address: string | null
  local_scan_ts: string
  sync_ts: string | null
  device_id: string | null
  sync_delayed: boolean
  created_at: string
}

interface PageData {
  items: ScanAttemptRow[]
  nextCursor: string | null
}

interface Filters {
  outcome: string
  actor_type: string
  date_from: string
  date_to: string
  container_id: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: Filters = {
  outcome: "",
  actor_type: "",
  date_from: "",
  date_to: "",
  container_id: "",
}

const OUTCOME_OPTIONS = [
  "success",
  "hmac_invalid",
  "auth_required",
  "fpa_blocked",
  "already_claimed",
  "window_expired",
  "state_mismatch",
  "condition_rejected",
  "product_draft",
  "rate_limited",
] as const

const ACTOR_TYPE_OPTIONS = ["farmer", "dealer", "admin"] as const

const OUTCOME_CLASS: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  hmac_invalid: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  auth_required: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  fpa_blocked: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  already_claimed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  window_expired: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  state_mismatch: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  condition_rejected: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  product_draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  rate_limited: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApiUrl(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams()
  if (filters.outcome) params.set("outcome", filters.outcome)
  if (filters.actor_type) params.set("actor_type", filters.actor_type)
  if (filters.date_from) params.set("date_from", filters.date_from)
  if (filters.date_to) params.set("date_to", filters.date_to)
  if (filters.container_id) params.set("container_id", filters.container_id)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return `/api/scan-attempts${qs ? `?${qs}` : ""}`
}

function buildExportUrl(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.outcome) params.set("outcome", filters.outcome)
  if (filters.actor_type) params.set("actor_type", filters.actor_type)
  if (filters.date_from) params.set("date_from", filters.date_from)
  if (filters.date_to) params.set("date_to", filters.date_to)
  if (filters.container_id) params.set("container_id", filters.container_id)
  const qs = params.toString()
  return `/api/scan-attempts/export${qs ? `?${qs}` : ""}`
}

function shortUuid(id: string | null): string {
  if (!id) return "—"
  return id.slice(0, 8) + "…"
}

function formatTs(ts: string): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC"
}

function labelStep(step: string): string {
  return step.replace(/_/g, " ")
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScanAttemptsPage() {
  // Applied filters drive data fetching; pending filters are form state.
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS)
  const [pendingFilters, setPendingFilters] = useState<Filters>(EMPTY_FILTERS)

  // cursorHistory[i] is the cursor that was used to load page i.
  // Empty = first page (no cursor). Each "next" push appends the cursor used.
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const [items, setItems] = useState<ScanAttemptRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Abort controller ref for in-flight fetch cancellation on filter change.
  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (filters: Filters, cursor: string | null) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setLoading(true)
      setError(null)

      try {
        const res = await fetch(buildApiUrl(filters, cursor), { signal: ac.signal })
        if (!res.ok) {
          const body = (await res.json()) as { error?: { message?: string } }
          throw new Error(body.error?.message ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as {
          data: ScanAttemptRow[]
          pagination: { next_cursor: string | null; has_more: boolean }
        }
        setItems(body.data)
        setNextCursor(body.pagination.next_cursor)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setError((err as Error).message ?? "Failed to load scan attempts")
        setItems([])
        setNextCursor(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  // Fetch whenever applied filters or page index changes.
  useEffect(() => {
    fetchPage(appliedFilters, cursorHistory[pageIndex] ?? null)
  }, [appliedFilters, pageIndex, cursorHistory, fetchPage])

  function applyFilters() {
    const newFilters = { ...pendingFilters }
    setAppliedFilters(newFilters)
    // Reset pagination.
    setCursorHistory([null])
    setPageIndex(0)
    setNextCursor(null)
  }

  function clearFilters() {
    setPendingFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setCursorHistory([null])
    setPageIndex(0)
    setNextCursor(null)
  }

  function goNext() {
    if (!nextCursor) return
    // Extend history if moving beyond what we've cached.
    setCursorHistory((prev) => {
      const next = [...prev]
      if (pageIndex + 1 >= next.length) next.push(nextCursor)
      return next
    })
    setPageIndex((i) => i + 1)
  }

  function goPrev() {
    if (pageIndex === 0) return
    setPageIndex((i) => i - 1)
  }

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean)
  const isFirstPage = pageIndex === 0
  const hasNextPage = nextCursor !== null

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Scan Attempts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CRM forensics — all scan events recorded by the system.
          </p>
        </div>
        <a href={buildExportUrl(appliedFilters)} download>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </a>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* Outcome */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Outcome</label>
              <select
                value={pendingFilters.outcome}
                onChange={(e) =>
                  setPendingFilters((f) => ({ ...f, outcome: e.target.value }))
                }
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              >
                <option value="">All outcomes</option>
                {OUTCOME_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Actor type */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Actor type</label>
              <select
                value={pendingFilters.actor_type}
                onChange={(e) =>
                  setPendingFilters((f) => ({ ...f, actor_type: e.target.value }))
                }
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              >
                <option value="">All types</option>
                {ACTOR_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <input
                type="date"
                value={pendingFilters.date_from}
                onChange={(e) =>
                  setPendingFilters((f) => ({ ...f, date_from: e.target.value }))
                }
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <input
                type="date"
                value={pendingFilters.date_to}
                onChange={(e) =>
                  setPendingFilters((f) => ({ ...f, date_to: e.target.value }))
                }
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>

            {/* Container UUID prefix */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Container ID prefix</label>
              <input
                type="text"
                placeholder="e.g. 9de5da4f…"
                value={pendingFilters.container_id}
                onChange={(e) =>
                  setPendingFilters((f) => ({ ...f, container_id: e.target.value.trim() }))
                }
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={applyFilters}>
              <Search className="mr-2 h-3.5 w-3.5" />
              Apply
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Results table ── */}
      <Card>
        <CardContent className="pt-0 px-0">
          {error && (
            <div className="px-6 py-4 text-sm text-destructive">
              Error: {error}
            </div>
          )}

          {loading && !error && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No scan attempts found.
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44 whitespace-nowrap">Timestamp (UTC)</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-center">Delayed</TableHead>
                    <TableHead>IP address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {formatTs(row.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shortUuid(row.container_id)}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs text-muted-foreground">
                          {shortUuid(row.actor_id)}
                        </div>
                        <div className="text-xs text-muted-foreground/60">{row.actor_type}</div>
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {labelStep(row.step)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            OUTCOME_CLASS[row.outcome] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {row.outcome.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {row.sync_delayed ? "yes" : "no"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.ip_address ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {pageIndex + 1}
          {hasActiveFilters && " · filtered"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={isFirstPage || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!hasNextPage || loading}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
