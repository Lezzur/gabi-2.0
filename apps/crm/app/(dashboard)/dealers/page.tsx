"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Clock, Search, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealerListItem {
  id: string
  user_id: string
  business_name: string
  territory_notes: string | null
  is_verified: boolean
  verified_at: string | null
  created_at: string
}

interface ListResponse {
  data: DealerListItem[]
  pagination: { next_cursor: string | null; has_more: boolean }
  meta: { request_id: string }
}

type VerifiedFilter = "all" | "verified" | "unverified"

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DealersPage() {
  const [dealers, setDealers] = useState<DealerListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [verifiedFilter, setVerifiedFilter] = useState<VerifiedFilter>("all")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function buildUrl(opts: {
    cursor?: string | null
    search: string
    verifiedFilter: VerifiedFilter
  }): string {
    const params = new URLSearchParams()
    params.set("limit", "20")
    if (opts.cursor) params.set("cursor", opts.cursor)
    if (opts.search) params.set("search", opts.search)
    if (opts.verifiedFilter === "verified") params.set("is_verified", "true")
    else if (opts.verifiedFilter === "unverified") params.set("is_verified", "false")
    return `/api/dealers?${params.toString()}`
  }

  const fetchDealers = useCallback(async (s: string, vf: VerifiedFilter) => {
    setLoading(true)
    try {
      const res = await fetch(buildUrl({ search: s, verifiedFilter: vf }))
      if (!res.ok) {
        toast.error("Failed to load dealers")
        return
      }
      const json: ListResponse = await res.json()
      setDealers(json.data)
      setCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(buildUrl({ cursor, search, verifiedFilter }))
      if (!res.ok) {
        toast.error("Failed to load more dealers")
        return
      }
      const json: ListResponse = await res.json()
      setDealers(prev => [...prev, ...json.data])
      setCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, search, verifiedFilter])

  useEffect(() => {
    fetchDealers(search, verifiedFilter)
  }, [search, verifiedFilter, fetchDealers])

  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(value.trim()), 350)
  }

  function handleFilterChange(value: string) {
    setVerifiedFilter(value as VerifiedFilter)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Dealers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage dealer accounts and verification.
          </p>
        </div>
        <Button asChild>
          <Link href="/dealers/invite">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Dealer
          </Link>
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or territory…"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={verifiedFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All dealers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dealers</SelectItem>
            <SelectItem value="verified">Verified only</SelectItem>
            <SelectItem value="unverified">Unverified only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {loading
              ? "Loading…"
              : `${dealers.length} dealer${dealers.length !== 1 ? "s" : ""}${hasMore ? "+" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : dealers.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No dealers found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business</TableHead>
                    <TableHead className="hidden sm:table-cell">Territory</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Joined</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dealers.map(dealer => (
                    <TableRow key={dealer.id}>
                      <TableCell className="font-medium">{dealer.business_name}</TableCell>
                      <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground sm:table-cell">
                        {dealer.territory_notes ?? "—"}
                      </TableCell>
                      <TableCell>
                        {dealer.is_verified ? (
                          <Badge className="gap-1 bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {new Date(dealer.created_at).toLocaleDateString("en-PH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/dealers/${dealer.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {hasMore && (
            <div className="border-t p-4 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
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
