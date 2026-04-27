"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Leaf,
  RefreshCw,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { cn } from "@/lib/utils"
import type { ProductCategory, ProductListItem, ProductStatus } from "../page"

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | ProductStatus
type CategoryFilter = "all" | ProductCategory

interface Props {
  initialProducts: ProductListItem[]
  initialHasMore: boolean
  initialNextCursor: string | null
  initialFilters: {
    status: StatusFilter
    category: CategoryFilter
    search: string
  }
  initialError: boolean
}

interface ApiResponse {
  data: ProductListItem[]
  pagination: { next_cursor: string | null; has_more: boolean }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: "Active",
  draft: "Draft",
  suspended: "Suspended",
}

const STATUS_CLASS: Record<ProductStatus, string> = {
  active:
    "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900",
  draft:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  suspended:
    "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-700",
}

function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASS[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function FpaExpiry({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>

  const expiry = new Date(date)
  const now = new Date()
  const daysUntil = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const formatted = expiry.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  if (daysUntil < 0) {
    return (
      <span className="font-medium tabular-nums text-red-600 dark:text-red-400">{formatted}</span>
    )
  }
  if (daysUntil <= 90) {
    return (
      <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
        {formatted}
      </span>
    )
  }
  return <span className="tabular-nums text-green-700 dark:text-green-400">{formatted}</span>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductsClient({
  initialProducts,
  initialHasMore,
  initialNextCursor,
  initialFilters,
  initialError,
}: Props) {
  const router = useRouter()

  // ── Data state ──────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductListItem[]>(initialProducts)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)

  // Stack of cursors used to fetch each visited page (null = page 1)
  const [prevCursors, setPrevCursors] = useState<Array<string | null>>([])
  // Cursor used to fetch the current page (for retry)
  const currentCursorRef = useRef<string | null>(null)

  // ── Filter state ────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState(initialFilters.search)
  const [status, setStatus] = useState<StatusFilter>(initialFilters.status)
  const [category, setCategory] = useState<CategoryFilter>(initialFilters.category)
  // Committed search (after 300ms debounce)
  const [search, setSearch] = useState(initialFilters.search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs for latest filter values (avoids stale closure in debounce callback)
  const statusRef = useRef(status)
  statusRef.current = status
  const categoryRef = useRef(category)
  categoryRef.current = category

  // ── URL sync ────────────────────────────────────────────────────────────────
  function syncUrl(opts: { status: StatusFilter; category: CategoryFilter; search: string }) {
    const params = new URLSearchParams()
    if (opts.status !== "all") params.set("status", opts.status)
    if (opts.category !== "all") params.set("category", opts.category)
    if (opts.search) params.set("search", opts.search)
    const qs = params.toString()
    window.history.replaceState(null, "", `/products${qs ? `?${qs}` : ""}`)
  }

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (opts: {
      status: StatusFilter
      category: CategoryFilter
      search: string
      cursor: string | null
    }) => {
      setLoading(true)
      setError(false)
      try {
        const params = new URLSearchParams()
        params.set("limit", "50")
        if (opts.status !== "all") params.set("status", opts.status)
        if (opts.category !== "all") params.set("category", opts.category)
        if (opts.search.trim()) params.set("search", opts.search.trim())
        if (opts.cursor) params.set("cursor", opts.cursor)

        const res = await fetch(`/api/products?${params.toString()}`)
        if (!res.ok) {
          setError(true)
          return
        }
        const json: ApiResponse = await res.json()
        setProducts(json.data)
        setNextCursor(json.pagination.next_cursor)
        setHasMore(json.pagination.has_more)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  // ── Filter change handlers ──────────────────────────────────────────────────
  function handleSearchInput(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const committed = value.trim()
      setSearch(committed)
      setPrevCursors([])
      currentCursorRef.current = null
      syncUrl({ status: statusRef.current, category: categoryRef.current, search: committed })
      void fetchPage({
        status: statusRef.current,
        category: categoryRef.current,
        search: committed,
        cursor: null,
      })
    }, 300)
  }

  function handleStatusChange(value: string) {
    const newStatus = value as StatusFilter
    setStatus(newStatus)
    statusRef.current = newStatus
    setPrevCursors([])
    currentCursorRef.current = null
    syncUrl({ status: newStatus, category, search })
    void fetchPage({ status: newStatus, category, search, cursor: null })
  }

  function handleCategoryChange(value: string) {
    const newCategory = value as CategoryFilter
    setCategory(newCategory)
    categoryRef.current = newCategory
    setPrevCursors([])
    currentCursorRef.current = null
    syncUrl({ status, category: newCategory, search })
    void fetchPage({ status, category: newCategory, search, cursor: null })
  }

  function handleClearFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput("")
    setSearch("")
    setStatus("all")
    setCategory("all")
    statusRef.current = "all"
    categoryRef.current = "all"
    setPrevCursors([])
    currentCursorRef.current = null
    syncUrl({ status: "all", category: "all", search: "" })
    void fetchPage({ status: "all", category: "all", search: "", cursor: null })
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  function handleNext() {
    if (!nextCursor) return
    setPrevCursors(prev => [...prev, currentCursorRef.current])
    currentCursorRef.current = nextCursor
    void fetchPage({ status, category, search, cursor: nextCursor })
  }

  function handlePrev() {
    if (prevCursors.length === 0) return
    const updated = [...prevCursors]
    const prevCursor = updated.pop() ?? null
    setPrevCursors(updated)
    currentCursorRef.current = prevCursor
    void fetchPage({ status, category, search, cursor: prevCursor })
  }

  function handleRetry() {
    void fetchPage({ status, category, search, cursor: currentCursorRef.current })
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const pageNumber = prevCursors.length + 1
  const hasFilters = status !== "all" || category !== "all" || search.trim() !== ""

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            FPA-registered agrochemical products.
          </p>
        </div>
        <Button asChild className="bg-[#C8952A] hover:bg-[#B07C22] text-white shrink-0">
          <Link href="/import-fpa">
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
            Import FPA
          </Link>
        </Button>
      </div>

      {/* ── Filters ── */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        role="search"
        aria-label="Product filters"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="product-search" className="text-xs font-medium text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              id="product-search"
              placeholder="Product name, company, or ingredient…"
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1 sm:w-40">
          <Label htmlFor="status-filter" className="text-xs font-medium text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger id="status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 sm:w-52">
          <Label htmlFor="category-filter" className="text-xs font-medium text-muted-foreground">
            Toxicity Category
          </Label>
          <Select value={category} onValueChange={handleCategoryChange}>
            <SelectTrigger id="category-filter">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="1">Category 1 — Extremely Hazardous</SelectItem>
              <SelectItem value="2">Category 2 — Highly Hazardous</SelectItem>
              <SelectItem value="3">Category 3 — Moderately Hazardous</SelectItem>
              <SelectItem value="4">Category 4 — Slightly Hazardous</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Table card ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {loading
              ? "Loading…"
              : error
                ? "Error loading products"
                : `${products.length} product${products.length !== 1 ? "s" : ""}${hasMore ? "+" : ""} — page ${pageNumber}`}
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4" aria-label="Loading products" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center" role="alert">
              <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-medium">Something went wrong</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  We couldn&apos;t load the products. Please try again.
                </p>
              </div>
              <Button variant="outline" onClick={handleRetry}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : products.length === 0 ? (
            hasFilters ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">No products match your filters.</p>
                <button
                  onClick={handleClearFilters}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Leaf className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium">No products yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Import via FPA spreadsheet or OCR to get started.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button asChild className="bg-[#C8952A] hover:bg-[#B07C22] text-white">
                    <Link href="/import-fpa">
                      <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
                      Import FPA Spreadsheet
                    </Link>
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Product Name</TableHead>
                    <TableHead scope="col" className="hidden sm:table-cell">
                      Company
                    </TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">
                      FPA Reg #
                    </TableHead>
                    <TableHead scope="col">FPA Expiry</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col" className="hidden lg:table-cell">
                      Last Updated
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map(product => (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/products/${product.id}`)}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/products/${product.id}`}
                          className="hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {product.product_name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {product.company}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="block max-w-[160px] truncate font-mono text-xs text-muted-foreground">
                          {product.fpa_registration_number ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <FpaExpiry date={product.fpa_registration_expires_at} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={product.status} />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {formatDate(product.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Pagination ── */}
          {!loading && !error && products.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">Page {pageNumber}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrev}
                  disabled={prevCursors.length === 0}
                  aria-label="Go to previous page"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNext}
                  disabled={!hasMore}
                  aria-label="Go to next page"
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
