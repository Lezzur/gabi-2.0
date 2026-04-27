import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import type { AppRole } from "@/lib/auth/session"
import ProductDetailClient from "./_components/ProductDetailClient"

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const user = await getSession()
  if (!user) redirect("/login")
  const role = (user.app_metadata?.role as AppRole | undefined) ?? null
  return <ProductDetailClient id={params.id} role={role} />
}
