import { cookies } from "next/headers"
import { createServerClient } from "@gaia/supabase"
import { encodeCursor, sanitiseSearch } from "@/lib/api"
import ProductsClient from "./_components/ProductsClient"

// ─── Shared types (consumed by ProductsClient) ────────────────────────────────

export type ProductStatus = "draft" | "active" | "suspended"
export type ProductCategory = "1" | "2" | "3" | "4"

export interface ProductListItem {
  id: string
  product_name: string
  company: string
  fpa_registration_number: string | null
  fpa_registration_expires_at: string | null
  status: ProductStatus
  updated_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT = 50
const VALID_STATUSES = new Set(["draft", "active", "suspended"])
const VALID_CATEGORIES = new Set(["1", "2", "3", "4"])
const LIST_COLUMNS =
  "id, product_name, company, fpa_registration_number, fpa_registration_expires_at, status, updated_at"

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const rawStatus = typeof searchParams.status === "string" ? searchParams.status : ""
  const rawCategory = typeof searchParams.category === "string" ? searchParams.category : ""
  const rawSearch = typeof searchParams.search === "string" ? searchParams.search : ""

  const status = VALID_STATUSES.has(rawStatus) ? (rawStatus as ProductStatus) : undefined
  const category = VALID_CATEGORIES.has(rawCategory) ? (rawCategory as ProductCategory) : undefined
  const search = rawSearch.trim() || undefined

  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)

  let query = supabase
    .from("products")
    .select(LIST_COLUMNS)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMIT + 1)

  if (status) query = query.eq("status", status)
  if (category) query = query.eq("category", category)
  if (search) {
    const safe = sanitiseSearch(search)
    if (safe.length > 0) {
      query = query.or(
        `product_name.ilike.%${safe}%,company.ilike.%${safe}%,active_ingredient.ilike.%${safe}%`,
      )
    }
  }

  const { data, error } = await query

  const hasError = !!error
  const hasMore = !hasError && !!data && data.length > LIMIT
  const items = hasError || !data ? [] : hasMore ? data.slice(0, LIMIT) : data
  const last = items.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null

  return (
    <ProductsClient
      initialProducts={items as ProductListItem[]}
      initialHasMore={hasMore}
      initialNextCursor={nextCursor}
      initialFilters={{
        status: (status ?? "all") as "all" | ProductStatus,
        category: (category ?? "all") as "all" | ProductCategory,
        search: search ?? "",
      }}
      initialError={hasError}
    />
  )
}
