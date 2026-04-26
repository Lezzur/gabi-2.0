"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Search, Wallet } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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

interface WalletRow {
  id: string
  user_id: string
  balance_points: number
  display_name: string | null
  phone_number: string | null
  role: string | null
  last_activity: string
}

interface ApiResponse {
  data: WalletRow[]
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

const ROLE_COLORS: Record<string, string> = {
  gabs_admin: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
  brand_admin: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  dealer: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  farmer: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
}

function RoleBadge({ role }: { role: string | null }) {
  const label = role ?? "unknown"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        ROLE_COLORS[label] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {label}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WalletsPage() {
  const [search, setSearch] = useState("")
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch the first page (resets list).
  const fetchFirst = useCallback(async (q: string) => {
    setLoading(true)
    setWallets([])
    setNextCursor(null)
    setHasMore(false)

    const url = new URL("/api/wallets", window.location.origin)
    if (q.trim()) url.searchParams.set("search", q.trim())

    try {
      const res = await fetch(url.toString())
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) {
        toast.error("Failed to load wallets")
        return
      }
      const json = (await res.json()) as ApiResponse
      setWallets(json.data)
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [])

  // Append the next page.
  const fetchMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    const url = new URL("/api/wallets", window.location.origin)
    url.searchParams.set("cursor", nextCursor)
    if (search.trim()) url.searchParams.set("search", search.trim())

    try {
      const res = await fetch(url.toString())
      if (!res.ok) {
        toast.error("Failed to load more wallets")
        return
      }
      const json = (await res.json()) as ApiResponse
      setWallets(prev => [...prev, ...json.data])
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, search])

  // Debounce search changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchFirst(search)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, fetchFirst])

  if (forbidden) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-destructive">
          You don&apos;t have permission to view wallets. Admin access required.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Wallets
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse user point balances and transaction history.
        </p>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* ── Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            {loading ? "Loading…" : `${wallets.length} wallet${wallets.length !== 1 ? "s" : ""}${hasMore ? "+" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : wallets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search.trim() ? "No wallets match your search." : "No wallets found."}
            </p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Last Activity</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map(w => (
                    <TableRow key={w.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {w.display_name ?? <span className="text-muted-foreground italic">No name</span>}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {w.phone_number ?? "—"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={w.role} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-medium">
                        {formatPoints(w.balance_points)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(w.last_activity)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/wallets/${w.user_id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </Link>
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
