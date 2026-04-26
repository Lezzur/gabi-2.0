"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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

interface Transaction {
  id: string
  delta: number
  reason: string
  scan_attempt_id: string | null
  created_at: string
}

interface WalletDetail {
  id: string
  user_id: string
  balance_points: number
  display_name: string | null
  phone_number: string | null
  role: string | null
  updated_at: string
  transactions: Transaction[]
}

interface ApiResponse {
  data: WalletDetail
  pagination: { next_cursor: string | null; has_more: boolean }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPoints(n: number): string {
  return n.toLocaleString() + " pts"
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function formatReason(reason: string): string {
  return reason.replace(/_/g, " ")
}

const ROLE_LABELS: Record<string, string> = {
  gabs_admin: "Admin",
  brand_admin: "Brand Admin",
  dealer: "Dealer",
  farmer: "Farmer",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WalletDetailPage({
  params,
}: {
  params: { userId: string }
}) {
  const { userId } = params

  const [wallet, setWallet] = useState<WalletDetail | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const fetchFirst = useCallback(async () => {
    setLoading(true)
    const url = new URL(`/api/wallets/${userId}`, window.location.origin)

    try {
      const res = await fetch(url.toString())
      if (res.status === 403) { setForbidden(true); return }
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) { toast.error("Failed to load wallet"); return }

      const json = (await res.json()) as ApiResponse
      setWallet(json.data)
      setTransactions(json.data.transactions)
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [userId])

  const fetchMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    const url = new URL(`/api/wallets/${userId}`, window.location.origin)
    url.searchParams.set("cursor", nextCursor)

    try {
      const res = await fetch(url.toString())
      if (!res.ok) { toast.error("Failed to load more transactions"); return }

      const json = (await res.json()) as ApiResponse
      setTransactions(prev => [...prev, ...json.data.transactions])
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, userId])

  useEffect(() => {
    void fetchFirst()
  }, [fetchFirst])

  if (forbidden) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-destructive">Admin access required.</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-4">
        <Link href="/wallets">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Wallets
          </Button>
        </Link>
        <p className="text-sm text-muted-foreground">Wallet not found.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      {/* ── Back link ── */}
      <Link href="/wallets">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Wallets
        </Button>
      </Link>

      {/* ── Header ── */}
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {loading ? (
            <Skeleton className="h-8 w-48 inline-block" />
          ) : (
            wallet?.display_name ?? "Unnamed User"
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono">
          {loading ? <Skeleton className="h-4 w-32 inline-block" /> : (wallet?.phone_number ?? "No phone number")}
        </p>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Balance"
          value={loading ? null : formatPoints(wallet?.balance_points ?? 0)}
          highlight
        />
        <SummaryCard
          label="Role"
          value={loading ? null : (ROLE_LABELS[wallet?.role ?? ""] ?? wallet?.role ?? "—")}
        />
        <SummaryCard
          label="Last Activity"
          value={loading ? null : (wallet ? formatDate(wallet.updated_at) : "—")}
        />
      </div>

      {/* ── Transaction history ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions yet.
            </p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Points</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map(tx => (
                    <TableRow key={tx.id}>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-mono tabular-nums text-sm font-medium",
                            tx.delta >= 0 ? "text-green-700 dark:text-green-400" : "text-destructive",
                          )}
                        >
                          {tx.delta >= 0 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          {tx.delta >= 0 ? "+" : ""}
                          {tx.delta.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {formatReason(tx.reason)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(tx.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string | null
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        highlight
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/20",
      )}
    >
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {value === null ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <p
          className={cn(
            "text-lg font-semibold tabular-nums",
            highlight && "text-primary",
          )}
        >
          {value}
        </p>
      )}
    </div>
  )
}
