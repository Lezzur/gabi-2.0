"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dealer {
  id: string
  user_id: string
  business_name: string
  territory_notes: string | null
  is_verified: boolean
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DealerDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [dealer, setDealer] = useState<Dealer | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)

  const fetchDealer = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dealers/${params.id}`)
      if (res.status === 404) {
        toast.error("Dealer not found")
        router.push("/dealers")
        return
      }
      if (!res.ok) {
        toast.error("Failed to load dealer")
        return
      }
      const json: { data: Dealer } = await res.json()
      setDealer(json.data)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [params.id, router])

  useEffect(() => {
    fetchDealer()
  }, [fetchDealer])

  async function handleVerify() {
    if (!dealer || dealer.is_verified) return
    setVerifying(true)
    try {
      const res = await fetch(`/api/dealers/${dealer.id}`, { method: "PATCH" })
      const json = await res.json()

      if (res.status === 409) {
        toast.error("Dealer is already verified")
        return
      }
      if (res.status === 403) {
        toast.error("Only admins can verify dealers")
        return
      }
      if (!res.ok) {
        toast.error("Failed to verify dealer — please try again")
        return
      }

      setDealer(prev =>
        prev
          ? {
              ...prev,
              is_verified: json.data.is_verified,
              verified_by: json.data.verified_by,
              verified_at: json.data.verified_at,
            }
          : prev,
      )
      toast.success(`${dealer.business_name} has been verified`)
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!dealer) return null

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link href="/dealers">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dealers</span>
          </Link>
        </Button>
        <h1 className="font-serif text-2xl font-semibold tracking-tight truncate">
          {dealer.business_name}
        </h1>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Dealer Account
            </CardTitle>
            {dealer.is_verified ? (
              <Badge className="gap-1 bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                Pending verification
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="grid gap-4">
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Business Name
              </dt>
              <dd className="text-sm">{dealer.business_name}</dd>
            </div>

            <Separator />

            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Territory
              </dt>
              <dd className="text-sm">{dealer.territory_notes ?? "Not specified"}</dd>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Joined
                </dt>
                <dd className="text-sm">
                  {new Date(dealer.created_at).toLocaleDateString("en-PH", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </dd>
              </div>

              {dealer.is_verified && dealer.verified_at && (
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Verified At
                  </dt>
                  <dd className="text-sm">
                    {new Date(dealer.verified_at).toLocaleDateString("en-PH", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </dd>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                User ID
              </dt>
              <dd className="font-mono text-xs text-muted-foreground break-all">
                {dealer.user_id}
              </dd>
            </div>
          </dl>

          {!dealer.is_verified && (
            <>
              <Separator />
              <Button
                onClick={handleVerify}
                disabled={verifying}
                className="w-full"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                {verifying ? "Verifying…" : "Verify Dealer"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
