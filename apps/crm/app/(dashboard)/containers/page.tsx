import { cookies } from "next/headers"
import { createServerClient, createServiceClient } from "@gaia/supabase"
import { encodeCursor } from "@/lib/api"
import ContainersClient from "./_components/ContainersClient"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContainerState =
  | "in_distribution"
  | "pending_purchase"
  | "purchased"
  | "returned"
  | "rewards_paid"

export type AppRole = "gabs_admin" | "brand_admin" | "dealer" | "farmer"

export interface ContainerListItem {
  id: string
  product_id: string
  product_name: string | null
  batch_number: string | null
  state: ContainerState
  manufacture_date: string | null
  formulation_expires_at: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT = 50

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ContainersPage() {
  const cookieStore = cookies()
  const authClient = createServerClient(cookieStore)
  const supabase = createServiceClient()

  const {
    data: { user },
  } = await authClient.auth.getUser()

  // Prefer user_role (set by generate route) then fall back to role (auth helper)
  const role =
    ((user?.app_metadata?.["user_role"] ?? user?.app_metadata?.["role"]) as AppRole | undefined) ??
    null

  const { data: rows, error } = await supabase
    .from("containers")
    .select("id, product_id, batch_number, state, manufacture_date, formulation_expires_at, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMIT + 1)

  const hasError = !!error
  const hasMore = !hasError && !!rows && rows.length > LIMIT
  const items = hasError || !rows ? [] : hasMore ? rows.slice(0, LIMIT) : rows

  // Resolve product names in a single query
  const productIds = [...new Set(items.map((r) => r.product_id))]
  const productNameMap = new Map<string, string>()
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id, product_name")
      .in("id", productIds)
    for (const p of products ?? []) {
      productNameMap.set(p.id, p.product_name)
    }
  }

  const last = items.at(-1)
  const nextCursor =
    hasMore && last ? encodeCursor(last.created_at, last.id) : null

  const initialContainers: ContainerListItem[] = items.map((row) => ({
    ...row,
    product_name: productNameMap.get(row.product_id) ?? null,
  }))

  return (
    <ContainersClient
      role={role}
      initialContainers={initialContainers}
      initialHasMore={hasMore}
      initialNextCursor={nextCursor}
      initialError={hasError}
    />
  )
}
