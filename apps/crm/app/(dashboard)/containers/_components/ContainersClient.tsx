"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import type { AppRole, ContainerListItem, ContainerState } from "../page"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  role: AppRole | null
  initialContainers: ContainerListItem[]
  initialHasMore: boolean
  initialNextCursor: string | null
  initialError: boolean
}

interface ListResponse {
  data: ContainerListItem[]
  pagination: { next_cursor: string | null; has_more: boolean }
}

interface ProductOption {
  id: string
  product_name: string
}

interface DealerOption {
  id: string
  business_name: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATE_LABEL: Record<ContainerState, string> = {
  in_distribution: "In Distribution",
  pending_purchase: "Pending Purchase",
  purchased: "Purchased",
  returned: "Returned",
  rewards_paid: "Rewards Paid",
}

const STATE_CLASS: Record<ContainerState, string> = {
  in_distribution:
    "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
  pending_purchase:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  purchased:
    "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900",
  returned:
    "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900",
  rewards_paid:
    "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-700",
}

function StateBadge({ state }: { state: ContainerState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATE_CLASS[state] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {STATE_LABEL[state] ?? state}
    </span>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContainersClient({
  role,
  initialContainers,
  initialHasMore,
  initialNextCursor,
  initialError,
}: Props) {
  const isAdmin = role === "gabs_admin" || role === "brand_admin"

  // ── List state ──────────────────────────────────────────────────────────────
  const [containers, setContainers] = useState<ContainerListItem[]>(initialContainers)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [prevCursors, setPrevCursors] = useState<Array<string | null>>([])
  const currentCursorRef = useRef<string | null>(null)

  // ── Filter state ────────────────────────────────────────────────────────────
  const [stateFilter, setStateFilter] = useState("all")
  const [productFilter, setProductFilter] = useState("all")
  const [batchInput, setBatchInput] = useState("")
  const [batch, setBatch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs to avoid stale closures in debounce
  const stateFilterRef = useRef(stateFilter)
  stateFilterRef.current = stateFilter
  const productFilterRef = useRef(productFilter)
  productFilterRef.current = productFilter

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Dialog / generate state ─────────────────────────────────────────────────
  const [genOpen, setGenOpen] = useState(false)
  const [genProducts, setGenProducts] = useState<ProductOption[]>([])
  const [genDealers, setGenDealers] = useState<DealerOption[]>([])
  const [genProductId, setGenProductId] = useState("")
  const [genQuantity, setGenQuantity] = useState<number | "">(100)
  const [genQuantityError, setGenQuantityError] = useState("")
  const [genDealerId, setGenDealerId] = useState("none")
  const [genSubmitting, setGenSubmitting] = useState(false)
  const [genLoadingOptions, setGenLoadingOptions] = useState(false)
  // Idempotency key: created on dialog open, kept for retries, cleared on close
  const genIdempotencyKey = useRef<string | null>(null)

  // ── Export state ────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  // ── Product options for filter bar ─────────────────────────────────────────
  const [filterProducts, setFilterProducts] = useState<ProductOption[]>([])

  useEffect(() => {
    fetch("/api/products?limit=100&status=active")
      .then((r) => r.json())
      .then((j: { data?: ProductOption[] }) => {
        if (j.data) setFilterProducts(j.data)
      })
      .catch(() => {})
  }, [])

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (opts: {
      state: string
      productId: string
      batch: string
      cursor: string | null
    }) => {
      setLoading(true)
      setError(false)
      setSelectedIds(new Set())
      try {
        const params = new URLSearchParams()
        params.set("limit", "50")
        if (opts.state !== "all") params.set("state", opts.state)
        if (opts.productId !== "all") params.set("product_id", opts.productId)
        if (opts.batch.trim()) params.set("batch_number", opts.batch.trim())
        if (opts.cursor) params.set("cursor", opts.cursor)

        const res = await fetch(`/api/containers?${params.toString()}`)
        if (!res.ok) {
          setError(true)
          return
        }
        const json: ListResponse = await res.json()
        setContainers(json.data)
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

  // ── Filter handlers ─────────────────────────────────────────────────────────
  function handleStateChange(value: string) {
    setStateFilter(value)
    stateFilterRef.current = value
    setPrevCursors([])
    currentCursorRef.current = null
    void fetchPage({ state: value, productId: productFilterRef.current, batch, cursor: null })
  }

  function handleProductChange(value: string) {
    setProductFilter(value)
    productFilterRef.current = value
    setPrevCursors([])
    currentCursorRef.current = null
    void fetchPage({ state: stateFilterRef.current, productId: value, batch, cursor: null })
  }

  function handleBatchInput(value: string) {
    setBatchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const committed = value.trim()
      setBatch(committed)
      setPrevCursors([])
      currentCursorRef.current = null
      void fetchPage({
        state: stateFilterRef.current,
        productId: productFilterRef.current,
        batch: committed,
        cursor: null,
      })
    }, 300)
  }

  function handleClearFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setStateFilter("all")
    setProductFilter("all")
    setBatchInput("")
    setBatch("")
    stateFilterRef.current = "all"
    productFilterRef.current = "all"
    setPrevCursors([])
    currentCursorRef.current = null
    void fetchPage({ state: "all", productId: "all", batch: "", cursor: null })
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  function handleNext() {
    if (!nextCursor) return
    setPrevCursors((prev) => [...prev, currentCursorRef.current])
    currentCursorRef.current = nextCursor
    void fetchPage({ state: stateFilter, productId: productFilter, batch, cursor: nextCursor })
  }

  function handlePrev() {
    if (prevCursors.length === 0) return
    const updated = [...prevCursors]
    const prevCursor = updated.pop() ?? null
    setPrevCursors(updated)
    currentCursorRef.current = prevCursor
    void fetchPage({ state: stateFilter, productId: productFilter, batch, cursor: prevCursor })
  }

  function handleRetry() {
    void fetchPage({
      state: stateFilter,
      productId: productFilter,
      batch,
      cursor: currentCursorRef.current,
    })
  }

  // ── Selection ───────────────────────────────────────────────────────────────
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(containers.map((c) => c.id)) : new Set())
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ── Generate dialog ─────────────────────────────────────────────────────────
  async function openGenDialog() {
    genIdempotencyKey.current = crypto.randomUUID()
    setGenProductId("")
    setGenQuantity(100)
    setGenQuantityError("")
    setGenDealerId("none")
    setGenOpen(true)

    setGenLoadingOptions(true)
    try {
      const [pRes, dRes] = await Promise.all([
        fetch("/api/products?limit=100&status=active"),
        fetch("/api/dealers?limit=100"),
      ])
      const [pJson, dJson] = await Promise.all([pRes.json(), dRes.json()])
      if (pJson.data) setGenProducts(pJson.data as ProductOption[])
      if (dJson.data) setGenDealers(dJson.data as DealerOption[])
    } catch {
      // Non-fatal — user can still submit if they know the IDs
    } finally {
      setGenLoadingOptions(false)
    }
  }

  function closeGenDialog() {
    genIdempotencyKey.current = null
    setGenOpen(false)
  }

  function validateQuantity(val: number | ""): string {
    if (val === "" || isNaN(Number(val))) return "Required"
    const n = Number(val)
    if (!Number.isInteger(n)) return "Must be a whole number"
    if (n < 1) return "Minimum is 1"
    if (n > 10_000) return "Maximum is 10,000"
    return ""
  }

  async function handleGenerate() {
    if (!genProductId) {
      toast.error("Please select a product")
      return
    }
    const qErr = validateQuantity(genQuantity)
    if (qErr) {
      setGenQuantityError(qErr)
      return
    }

    // Reuse existing key on retry; it was set when dialog opened
    if (!genIdempotencyKey.current) {
      genIdempotencyKey.current = crypto.randomUUID()
    }

    setGenSubmitting(true)
    try {
      const res = await fetch("/api/containers/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": genIdempotencyKey.current,
        },
        body: JSON.stringify({
          product_id: genProductId,
          quantity: Number(genQuantity),
          ...(genDealerId !== "none" ? { assigned_dealer_id: genDealerId } : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(
          (err as { error?: { message?: string } }).error?.message ?? "Failed to generate batch",
        )
        return
      }

      const { data } = await res.json()
      const shortId = (data.batch_id as string).slice(0, 8)

      closeGenDialog()

      toast.success(`Batch ${shortId}… created — ${data.container_count as number} containers`, {
        description: "Labels are ready to download.",
        action: {
          label: "Download PDF",
          onClick: () => void handleExport("pdf", containers.map((c) => c.id)),
        },
        duration: 10_000,
      })

      // Refresh list to show new containers
      void fetchPage({ state: stateFilter, productId: productFilter, batch, cursor: null })
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setGenSubmitting(false)
    }
  }

  // ── Export labels ───────────────────────────────────────────────────────────
  async function handleExport(format: "pdf" | "zpl", ids?: string[]) {
    const targetIds = ids ?? (selectedIds.size > 0 ? [...selectedIds] : containers.map((c) => c.id))

    if (targetIds.length === 0) {
      toast.error("No containers to export")
      return
    }

    setExporting(true)
    const toastId = toast.loading(
      `Preparing ${targetIds.length} label${targetIds.length !== 1 ? "s" : ""} (${format.toUpperCase()})…`,
    )

    try {
      const res = await fetch("/api/containers/export-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ container_ids: targetIds, format }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.dismiss(toastId)
        toast.error(
          (err as { error?: { message?: string } }).error?.message ?? "Export failed",
        )
        return
      }

      // Stream with progress tracking
      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body")

      const chunks: Uint8Array[] = []
      const contentLength = res.headers.get("Content-Length")
      const total = contentLength ? parseInt(contentLength, 10) : null
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (total && total > 0) {
          const pct = Math.round((received / total) * 100)
          toast.loading(`Downloading… ${pct}%`, { id: toastId })
        }
      }

      const mimeType =
        format === "pdf" ? "application/pdf" : "application/vnd.zebra-zpl"
      const blob = new Blob(chunks, { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `labels-${new Date().toISOString().slice(0, 10)}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.dismiss(toastId)
      toast.success(`${targetIds.length} label${targetIds.length !== 1 ? "s" : ""} downloaded`)
    } catch {
      toast.dismiss(toastId)
      toast.error("Export failed — please try again")
    } finally {
      setExporting(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const pageNumber = prevCursors.length + 1
  const hasFilters =
    stateFilter !== "all" || productFilter !== "all" || batch.trim() !== ""
  const allSelected =
    containers.length > 0 && containers.every((c) => selectedIds.has(c.id))
  const someSelected = selectedIds.size > 0 && !allSelected

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Containers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            QR-tagged containers for FPA-registered products.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Export Labels
                  <ChevronDown className="ml-2 h-3 w-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleExport("pdf")}>
                  Download PDF
                  {selectedIds.size > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({selectedIds.size} selected)
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleExport("zpl")}>
                  Download ZPL
                  {selectedIds.size > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({selectedIds.size} selected)
                    </span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Generate batch */}
            <Button
              className="bg-[#C8952A] hover:bg-[#B07C22] text-white"
              onClick={() => void openGenDialog()}
            >
              Generate Batch
            </Button>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-end flex-wrap"
        role="search"
        aria-label="Container filters"
      >
        <div className="space-y-1 sm:w-48">
          <Label htmlFor="state-filter" className="text-xs font-medium text-muted-foreground">
            State
          </Label>
          <Select value={stateFilter} onValueChange={handleStateChange}>
            <SelectTrigger id="state-filter">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="in_distribution">In Distribution</SelectItem>
              <SelectItem value="pending_purchase">Pending Purchase</SelectItem>
              <SelectItem value="purchased">Purchased</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="rewards_paid">Rewards Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filterProducts.length > 0 && (
          <div className="space-y-1 sm:w-56">
            <Label htmlFor="product-filter" className="text-xs font-medium text-muted-foreground">
              Product
            </Label>
            <Select value={productFilter} onValueChange={handleProductChange}>
              <SelectTrigger id="product-filter">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {filterProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.product_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1 space-y-1 min-w-[180px]">
          <Label htmlFor="batch-filter" className="text-xs font-medium text-muted-foreground">
            Batch #
          </Label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              id="batch-filter"
              placeholder="Filter by batch number…"
              value={batchInput}
              onChange={(e) => handleBatchInput(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* ── Table card ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {loading
              ? "Loading…"
              : error
                ? "Error loading containers"
                : `${containers.length} container${containers.length !== 1 ? "s" : ""}${hasMore ? "+" : ""} — page ${pageNumber}`}
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4" aria-label="Loading containers" aria-busy="true">
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
                  We couldn&apos;t load the containers. Please try again.
                </p>
              </div>
              <Button variant="outline" onClick={handleRetry}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : containers.length === 0 ? (
            hasFilters ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">No containers match your filters.</p>
                <button
                  onClick={handleClearFilters}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Box className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium">No containers yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Generate a batch to create QR-tagged containers.
                  </p>
                </div>
                {isAdmin && (
                  <Button
                    className="bg-[#C8952A] hover:bg-[#B07C22] text-white"
                    onClick={() => void openGenDialog()}
                  >
                    Generate Batch
                  </Button>
                )}
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => toggleAll(!!checked)}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    <TableHead scope="col">Container ID</TableHead>
                    <TableHead scope="col">Product</TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">
                      Batch #
                    </TableHead>
                    <TableHead scope="col">State</TableHead>
                    <TableHead scope="col" className="hidden lg:table-cell">
                      Manufacture Date
                    </TableHead>
                    <TableHead scope="col" className="hidden lg:table-cell">
                      Formulation Expiry
                    </TableHead>
                    <TableHead scope="col" className="hidden xl:table-cell">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {containers.map((c) => (
                    <TableRow
                      key={c.id}
                      className={cn(
                        selectedIds.has(c.id) && "bg-muted/50",
                      )}
                    >
                      {isAdmin && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={(checked) => toggleRow(c.id, !!checked)}
                            aria-label={`Select container ${c.id.slice(0, 8)}`}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.id.slice(0, 8)}…
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.product_name ?? (
                          <span className="text-muted-foreground italic">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="font-mono text-xs">{c.batch_number}</span>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={c.state} />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {c.manufacture_date ? formatDate(c.manufacture_date) : "—"}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {c.formulation_expires_at ? (
                          (() => {
                            const exp = new Date(c.formulation_expires_at)
                            const days = Math.floor(
                              (exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                            )
                            return (
                              <span
                                className={cn(
                                  "tabular-nums",
                                  days < 0
                                    ? "text-red-600 dark:text-red-400 font-medium"
                                    : days <= 90
                                      ? "text-amber-700 dark:text-amber-400"
                                      : "text-green-700 dark:text-green-400",
                                )}
                              >
                                {formatDate(c.formulation_expires_at)}
                              </span>
                            )
                          })()
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                        {formatDate(c.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Pagination ── */}
          {!loading && !error && containers.length > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {selectedIds.size > 0
                  ? `${selectedIds.size} of ${containers.length} selected`
                  : `Page ${pageNumber}`}
              </p>
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

      {/* ── Generate Batch Dialog ── */}
      <Dialog open={genOpen} onOpenChange={(open) => { if (!open) closeGenDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Container Batch</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Product selector */}
            <div className="space-y-1.5">
              <Label htmlFor="gen-product">
                Product <span className="text-destructive">*</span>
              </Label>
              {genLoadingOptions ? (
                <Skeleton className="h-10 w-full rounded-md" />
              ) : (
                <Select value={genProductId} onValueChange={setGenProductId}>
                  <SelectTrigger id="gen-product">
                    <SelectValue placeholder="Select an active product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {genProducts.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No active products found
                      </SelectItem>
                    ) : (
                      genProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.product_name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label htmlFor="gen-quantity">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gen-quantity"
                type="number"
                min={1}
                max={10_000}
                step={1}
                value={genQuantity}
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : parseInt(e.target.value, 10)
                  setGenQuantity(val as number | "")
                  setGenQuantityError(validateQuantity(val as number | ""))
                }}
                onBlur={() => setGenQuantityError(validateQuantity(genQuantity))}
                aria-describedby={genQuantityError ? "gen-quantity-error" : undefined}
                className={cn(genQuantityError && "border-destructive")}
              />
              {genQuantityError ? (
                <p id="gen-quantity-error" className="text-xs text-destructive">
                  {genQuantityError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">1 – 10,000 containers</p>
              )}
            </div>

            {/* Dealer assignment (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="gen-dealer">Assign to Dealer (optional)</Label>
              {genLoadingOptions ? (
                <Skeleton className="h-10 w-full rounded-md" />
              ) : (
                <Select value={genDealerId} onValueChange={setGenDealerId}>
                  <SelectTrigger id="gen-dealer">
                    <SelectValue placeholder="No dealer assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No dealer assignment</SelectItem>
                    {genDealers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.business_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeGenDialog} disabled={genSubmitting}>
              Cancel
            </Button>
            <Button
              className="bg-[#C8952A] hover:bg-[#B07C22] text-white"
              onClick={() => void handleGenerate()}
              disabled={genSubmitting || !genProductId}
            >
              {genSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {genSubmitting ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
