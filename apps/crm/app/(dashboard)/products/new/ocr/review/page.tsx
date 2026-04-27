"use client"

// ui-design §C4 — OCR review: extracted values shown as pre-filled inputs with
// a confidence badge per field. Low confidence (<0.7) fields have a visible
// highlight in addition to the badge — users must not miss them.

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { OcrConfidenceBadge, confidenceHighlight } from "@/components/ocr/confidence-badge"
import { cn } from "@/lib/utils"

interface OcrField {
  value: string
  confidence?: number
}

interface OcrResult {
  product_name?: OcrField
  company?: OcrField
  active_ingredient?: OcrField
  concentration?: OcrField
  formulation_type?: OcrField
  toxicity_category?: OcrField
  note_to_physician?: OcrField
  fpa_registration_number?: OcrField
  distributor?: OcrField
}

interface ReviewDraft {
  job_id: string
  product_name: string
  company: string
  active_ingredient: string
  concentration: string
  formulation_type: string
  toxicity_category: string
  note_to_physician: string
  fpa_registration_number: string
  distributor: string
  confidences: Record<string, number | undefined>
}

const FIELDS: { key: keyof ReviewDraft; label: string; textarea?: boolean }[] = [
  { key: "product_name", label: "Product Name" },
  { key: "company", label: "Company" },
  { key: "active_ingredient", label: "Active Ingredient" },
  { key: "concentration", label: "Concentration" },
  { key: "formulation_type", label: "Formulation Type" },
  { key: "toxicity_category", label: "Toxicity Category" },
  { key: "fpa_registration_number", label: "FPA Registration No." },
  { key: "distributor", label: "Distributor" },
  { key: "note_to_physician", label: "Note to Physician", textarea: true },
]

const DRAFT_KEY = (jobId: string) => `gaia:ocr:review:${jobId}`

export default function OcrReviewPage() {
  const router = useRouter()
  const params = useSearchParams()
  const jobId = params.get("job_id") ?? ""

  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load OCR result from Supabase and initialise draft
  useEffect(() => {
    if (!jobId) { setError("Missing job_id"); setLoading(false); return }

    // Try restoring auto-saved draft first
    const saved = localStorage.getItem(DRAFT_KEY(jobId))
    if (saved) {
      try {
        setDraft(JSON.parse(saved) as ReviewDraft)
        setLoading(false)
        return
      } catch { /* corrupted — re-fetch */ }
    }

    const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"]!
    const supabaseKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!

    fetch(`${supabaseUrl}/rest/v1/ocr_jobs?id=eq.${jobId}&select=result`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    })
      .then((r) => r.json())
      .then((rows: { result: OcrResult }[]) => {
        const result = rows[0]?.result ?? {}
        const d: ReviewDraft = {
          job_id: jobId,
          product_name: result.product_name?.value ?? "",
          company: result.company?.value ?? "",
          active_ingredient: result.active_ingredient?.value ?? "",
          concentration: result.concentration?.value ?? "",
          formulation_type: result.formulation_type?.value ?? "",
          toxicity_category: result.toxicity_category?.value ?? "",
          note_to_physician: result.note_to_physician?.value ?? "",
          fpa_registration_number: result.fpa_registration_number?.value ?? "",
          distributor: result.distributor?.value ?? "",
          confidences: Object.fromEntries(
            Object.entries(result).map(([k, v]) => [k, (v as OcrField).confidence]),
          ),
        }
        setDraft(d)
      })
      .catch(() => setError("Failed to load OCR result"))
      .finally(() => setLoading(false))
  }, [jobId])

  // Auto-save draft to localStorage every 10 s
  useEffect(() => {
    if (!draft) return
    autoSaveRef.current = setInterval(() => {
      localStorage.setItem(DRAFT_KEY(jobId), JSON.stringify(draft))
    }, 10_000)
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current) }
  }, [draft, jobId])

  function update(key: keyof ReviewDraft, value: string) {
    setDraft((d) => d ? { ...d, [key]: value } : d)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    localStorage.setItem(DRAFT_KEY(jobId), JSON.stringify(draft))
    router.push(`/products/new/ocr/confirm?job_id=${jobId}`)
  }

  if (loading) return <div className="p-10 text-sm text-muted-foreground">Loading OCR result…</div>
  if (error) return <div className="p-10 text-sm text-destructive">{error}</div>
  if (!draft) return null

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Review Extracted Fields</CardTitle>
          <p className="text-sm text-muted-foreground">
            Correct any errors before proceeding. Amber and red fields need attention.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {FIELDS.map(({ key, label, textarea }) => {
              const conf = draft.confidences[key]
              const highlight = confidenceHighlight(conf)
              return (
                <div key={key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={key}>{label}</Label>
                    <OcrConfidenceBadge confidence={conf} />
                  </div>
                  {textarea ? (
                    <textarea
                      id={key}
                      value={draft[key] as string}
                      onChange={(e) => update(key, e.target.value)}
                      rows={4}
                      className={cn(
                        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        highlight,
                      )}
                    />
                  ) : (
                    <Input
                      id={key}
                      value={draft[key] as string}
                      onChange={(e) => update(key, e.target.value)}
                      className={cn(highlight)}
                    />
                  )}
                </div>
              )
            })}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Back
              </Button>
              <Button type="submit">Continue to Safety Gate</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
