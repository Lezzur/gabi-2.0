"use client"

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  Box,
  ExternalLink,
  Leaf,
  RefreshCw,
  Save,
  ScanLine,
} from "lucide-react"
import { toast } from "sonner"

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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { AppRole } from "@/lib/auth/session"

// ─── Types ─────────────────────────────────────────────────────────────────────

type ProductStatus = "draft" | "active" | "suspended"

interface ProductCrop {
  id: string
  crop: string
  pests: string | null
}

interface Product {
  id: string
  product_name: string
  brand_name: string | null
  company: string
  active_ingredient: string
  concentration: string | null
  formulation_type: string | null
  type: string | null
  category: string | null
  fpa_registration_number: string | null
  fpa_registration_expires_at: string | null
  fpa_last_imported_at: string | null
  mode_of_entry: string | null
  mode_of_action_group: string | null
  dosage_rate: string | null
  mrl: string | null
  pre_harvest_interval: string | null
  re_entry_period: string | null
  distributor: string | null
  formulated_by: string | null
  imported_by: string | null
  timing_of_application: string | null
  note_to_physician: string | null
  pests: string | null
  status: ProductStatus
  category_confirmed_by: string | null
  category_confirmed_at: string | null
  note_to_physician_confirmed_by: string | null
  note_to_physician_confirmed_at: string | null
  label_image_storage_path: string | null
  created_at: string
  updated_at: string
  crops: ProductCrop[]
}

interface FieldErrors {
  product_name?: string
  note_to_physician?: string
  status?: string
  _general?: string
}

interface Props {
  id: string
  role: AppRole | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
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
    month: "long",
    day: "numeric",
  })

  if (daysUntil < 0) {
    return <span className="font-medium text-red-600 dark:text-red-400">{formatted}</span>
  }
  if (daysUntil <= 90) {
    return <span className="font-medium text-amber-700 dark:text-amber-400">{formatted}</span>
  }
  return <span className="text-green-700 dark:text-green-400">{formatted}</span>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ProductDetailClient({ id, role }: Props) {
  const router = useRouter()

  // ── Product state ──────────────────────────────────────────────────────────
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // ── Container stat ─────────────────────────────────────────────────────────
  const [containerCount, setContainerCount] = useState<number | null>(null)
  const [containerHasMore, setContainerHasMore] = useState(false)

  // ── Edit form ──────────────────────────────────────────────────────────────
  const [productName, setProductName] = useState("")
  const [noteToPhysician, setNoteToPhysician] = useState("")
  const [status, setStatus] = useState<ProductStatus>("draft")
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [dirty, setDirty] = useState(false)

  // Snapshot for rollback on save failure
  const savedProductRef = useRef<Product | null>(null)

  // ── Permissions ────────────────────────────────────────────────────────────
  const canEdit = role === "gabs_admin" || role === "brand_admin"
  const canEditProductName = role === "gabs_admin"
  const canEditStatus = role === "gabs_admin"

  // ── Fetch product ──────────────────────────────────────────────────────────
  const fetchProduct = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/products/${id}`)
      if (res.status === 404) {
        toast.error("Product not found")
        router.push("/products")
        return
      }
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const json: { data: Product } = await res.json()
      const p = json.data
      setProduct(p)
      setProductName(p.product_name)
      setNoteToPhysician(p.note_to_physician ?? "")
      setStatus(p.status)
      savedProductRef.current = p
      setDirty(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [id, router])

  // ── Fetch container count ──────────────────────────────────────────────────
  const fetchContainerCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/containers?product_id=${encodeURIComponent(id)}&limit=100`)
      if (!res.ok) return
      const json: { data: unknown[]; pagination: { has_more: boolean } } = await res.json()
      setContainerCount(json.data.length)
      setContainerHasMore(json.pagination.has_more)
    } catch {
      // non-critical stat — fail silently
    }
  }, [id])

  useEffect(() => {
    void fetchProduct()
    void fetchContainerCount()
  }, [fetchProduct, fetchContainerCount])

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!product) return
    setDirty(
      productName !== product.product_name ||
        noteToPhysician !== (product.note_to_physician ?? "") ||
        status !== product.status,
    )
  }, [productName, noteToPhysician, status, product])

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!product || saving || !dirty) return
    setSaving(true)
    setFieldErrors({})

    // Optimistic update — roll back on error
    const snapshot = savedProductRef.current!
    setProduct({
      ...product,
      product_name: canEditProductName ? productName : product.product_name,
      note_to_physician: noteToPhysician || null,
      status: canEditStatus ? status : product.status,
    })

    // Only send changed fields
    const body: Record<string, string | null> = {}
    if (canEditProductName && productName !== snapshot.product_name) {
      body.product_name = productName
    }
    if (noteToPhysician !== (snapshot.note_to_physician ?? "")) {
      body.note_to_physician = noteToPhysician || null
    }
    if (canEditStatus && status !== snapshot.status) {
      body.status = status
    }

    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const json = await res.json()

      if (!res.ok) {
        // Rollback optimistic update
        setProduct(snapshot)

        if (res.status === 422) {
          setFieldErrors({
            status:
              "Cannot set status to Active without confirmed safety fields (category + note to physician).",
          })
          return
        }

        if (res.status === 403) {
          toast.error("You don't have permission to edit this product.")
          return
        }

        const details: { field: string; issue: string }[] = json?.error?.details ?? []
        if (details.length > 0) {
          const errs: FieldErrors = {}
          for (const d of details) {
            if (d.field === "product_name") errs.product_name = d.issue
            else if (d.field === "note_to_physician") errs.note_to_physician = d.issue
            else if (d.field === "status") errs.status = d.issue
            else errs._general = errs._general ? `${errs._general}; ${d.issue}` : d.issue
          }
          setFieldErrors(errs)
        } else {
          toast.error("Failed to save changes — please try again.")
        }
        return
      }

      const updated: Product = json.data
      setProduct(updated)
      setProductName(updated.product_name)
      setNoteToPhysician(updated.note_to_physician ?? "")
      setStatus(updated.status)
      savedProductRef.current = updated
      setDirty(false)
      toast.success("Changes saved.")
    } catch {
      setProduct(snapshot)
      toast.error("Network error — please try again.")
    } finally {
      setSaving(false)
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-col items-center gap-4 py-20 text-center" role="alert">
          <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium">Failed to load product</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Something went wrong. Please try again.
            </p>
          </div>
          <Button variant="outline" onClick={() => void fetchProduct()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // ── Empty (redirected) ─────────────────────────────────────────────────────
  if (!product) return null

  const containerCountLabel =
    containerCount === null
      ? "—"
      : containerHasMore
        ? `${containerCount}+`
        : String(containerCount)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0 mt-0.5">
          <Link href="/products">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to products</span>
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              {product.product_name}
            </h1>
            <StatusBadge status={product.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{product.company}</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Box className="h-8 w-8 text-muted-foreground shrink-0" aria-hidden="true" />
              <div>
                <p className="text-2xl font-bold tabular-nums">{containerCountLabel}</p>
                <p className="text-xs text-muted-foreground">Containers</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <ScanLine className="h-8 w-8 text-muted-foreground shrink-0" aria-hidden="true" />
              <div>
                <p className="text-2xl font-bold tabular-nums">—</p>
                <p className="text-xs text-muted-foreground">Recent scans (30d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── View containers CTA ── */}
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/containers?product_id=${product.id}`}>
            <Box className="mr-2 h-4 w-4" aria-hidden="true" />
            View Containers
            <ExternalLink className="ml-2 h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* ── FPA Registration (read-only) ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Leaf className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            FPA Registration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <ReadOnlyField
              label="FPA Reg #"
              value={
                product.fpa_registration_number ? (
                  <span className="font-mono text-xs">{product.fpa_registration_number}</span>
                ) : null
              }
            />
            <ReadOnlyField
              label="FPA Expiry"
              value={<FpaExpiry date={product.fpa_registration_expires_at} />}
            />
            <ReadOnlyField
              label="Last Imported"
              value={product.fpa_last_imported_at ? formatDate(product.fpa_last_imported_at) : null}
            />
            <ReadOnlyField
              label="Type"
              value={product.type ?? null}
            />
            <ReadOnlyField label="Formulation" value={product.formulation_type ?? null} />
            <ReadOnlyField
              label="Toxicity Category"
              value={product.category ? `Category ${product.category}` : null}
            />
            <ReadOnlyField label="Active Ingredient" value={product.active_ingredient} />
            <ReadOnlyField label="Concentration" value={product.concentration ?? null} />
          </dl>
        </CardContent>
      </Card>

      {/* ── Product details (read-only agronomic fields) ── */}
      {(product.mode_of_entry ||
        product.mode_of_action_group ||
        product.dosage_rate ||
        product.timing_of_application ||
        product.mrl ||
        product.pre_harvest_interval ||
        product.re_entry_period ||
        product.pests ||
        product.distributor ||
        product.formulated_by ||
        product.imported_by) && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Product Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              {product.mode_of_entry && (
                <ReadOnlyField label="Mode of Entry" value={product.mode_of_entry} />
              )}
              {product.mode_of_action_group && (
                <ReadOnlyField label="Mode of Action Group" value={product.mode_of_action_group} />
              )}
              {product.dosage_rate && (
                <ReadOnlyField label="Dosage Rate" value={product.dosage_rate} />
              )}
              {product.timing_of_application && (
                <ReadOnlyField label="Timing of Application" value={product.timing_of_application} />
              )}
              {product.mrl && <ReadOnlyField label="MRL" value={product.mrl} />}
              {product.pre_harvest_interval && (
                <ReadOnlyField label="Pre-Harvest Interval" value={product.pre_harvest_interval} />
              )}
              {product.re_entry_period && (
                <ReadOnlyField label="Re-entry Period" value={product.re_entry_period} />
              )}
              {product.pests && <ReadOnlyField label="Target Pests" value={product.pests} />}
              {product.distributor && (
                <ReadOnlyField label="Distributor" value={product.distributor} />
              )}
              {product.formulated_by && (
                <ReadOnlyField label="Formulated By" value={product.formulated_by} />
              )}
              {product.imported_by && (
                <ReadOnlyField label="Imported By" value={product.imported_by} />
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* ── Registered crops ── */}
      {product.crops.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Registered Crops</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Crop
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pests
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {product.crops.map(crop => (
                    <tr key={crop.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{crop.crop}</td>
                      <td className="px-4 py-2 text-muted-foreground">{crop.pests ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Edit form (admin only) ── */}
      {canEdit && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Edit Product</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Product Name — gabs_admin only */}
            {canEditProductName && (
              <div className="space-y-1.5">
                <Label htmlFor="product-name">Product Name</Label>
                <Input
                  id="product-name"
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.product_name}
                  className={cn(fieldErrors.product_name && "border-destructive")}
                />
                {fieldErrors.product_name && (
                  <p className="text-xs text-destructive" role="alert">
                    {fieldErrors.product_name}
                  </p>
                )}
              </div>
            )}

            {/* Note to Physician — all admins */}
            <div className="space-y-1.5">
              <Label htmlFor="note-to-physician">Note to Physician</Label>
              <textarea
                id="note-to-physician"
                value={noteToPhysician}
                onChange={e => setNoteToPhysician(e.target.value)}
                disabled={saving}
                rows={4}
                aria-invalid={!!fieldErrors.note_to_physician}
                placeholder="Medical guidance for first responders…"
                className={cn(
                  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y",
                  fieldErrors.note_to_physician && "border-destructive",
                )}
              />
              {fieldErrors.note_to_physician && (
                <p className="text-xs text-destructive" role="alert">
                  {fieldErrors.note_to_physician}
                </p>
              )}
            </div>

            {/* Status — gabs_admin only */}
            {canEditStatus && (
              <div className="space-y-1.5">
                <Label htmlFor="status-select">Status</Label>
                <Select
                  value={status}
                  onValueChange={v => setStatus(v as ProductStatus)}
                  disabled={saving}
                >
                  <SelectTrigger
                    id="status-select"
                    aria-invalid={!!fieldErrors.status}
                    className={cn(fieldErrors.status && "border-destructive")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                {fieldErrors.status && (
                  <p className="text-xs text-destructive" role="alert">
                    {fieldErrors.status}
                  </p>
                )}
              </div>
            )}

            {fieldErrors._general && (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors._general}
              </p>
            )}

            <Separator />

            <div className="flex justify-end">
              <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Metadata ── */}
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>Created {formatDate(product.created_at)}</span>
        <span>Updated {formatDate(product.updated_at)}</span>
      </div>
    </div>
  )
}
