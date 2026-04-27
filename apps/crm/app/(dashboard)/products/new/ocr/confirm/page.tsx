"use client"

// ui-design §C5 — Safety gate: the confirmed VALUE appears inside the checkbox
// label (not alongside it). This is a deliberate friction pattern — the user
// must read the exact extracted text while ticking. Do not refactor the labels
// to separate the value from the checkbox; that would defeat the purpose.

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SafetyCheckbox } from "@/components/ocr/safety-checkbox"

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
}

const DRAFT_KEY = (jobId: string) => `gaia:ocr:review:${jobId}`

export default function OcrConfirmPage() {
  const router = useRouter()
  const params = useSearchParams()
  const jobId = params.get("job_id") ?? ""

  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [confirmedIngredient, setConfirmedIngredient] = useState(false)
  const [confirmedToxicity, setConfirmedToxicity] = useState(false)
  const [confirmedNote, setConfirmedNote] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    const saved = localStorage.getItem(DRAFT_KEY(jobId))
    if (saved) {
      try { setDraft(JSON.parse(saved) as ReviewDraft) } catch { /* ignore */ }
    }
  }, [jobId])

  const allConfirmed = confirmedIngredient && confirmedToxicity && confirmedNote

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft || !allConfirmed) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch("/api/products/ocr/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocr_job_id: jobId,
          product_name: draft.product_name,
          company: draft.company,
          active_ingredient: draft.active_ingredient,
          concentration: draft.concentration || undefined,
          formulation_type: draft.formulation_type || undefined,
          toxicity_category: draft.toxicity_category || undefined,
          note_to_physician: draft.note_to_physician || undefined,
          fpa_registration_number: draft.fpa_registration_number || undefined,
          distributor: draft.distributor || undefined,
          confirmed_active_ingredient: confirmedIngredient,
          confirmed_toxicity_category: confirmedToxicity,
          confirmed_note_to_physician: confirmedNote,
        }),
      })

      const json = (await res.json()) as { data?: { product_id: string }; error?: { code: string; message: string } }

      if (!res.ok) {
        setError(json.error?.message ?? "Submission failed")
        return
      }

      localStorage.removeItem(DRAFT_KEY(jobId))
      router.push(`/products/${json.data!.product_id}`)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSubmitting(false)
    }
  }

  if (!draft) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        No review data found.{" "}
        <button className="underline" onClick={() => router.push("/products/new/ocr")}>
          Start over
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Safety Gate Confirmation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tick each checkbox after reading the exact value. All three are required.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <SafetyCheckbox
              id="confirm-ingredient"
              checked={confirmedIngredient}
              onCheckedChange={setConfirmedIngredient}
              prefix="I confirm the active ingredient is:"
              value={draft.active_ingredient || "(not provided)"}
            />

            <SafetyCheckbox
              id="confirm-toxicity"
              checked={confirmedToxicity}
              onCheckedChange={setConfirmedToxicity}
              prefix="I confirm the toxicity category is:"
              value={
                draft.toxicity_category
                  ? `Category ${draft.toxicity_category}`
                  : "(not provided)"
              }
            />

            <SafetyCheckbox
              id="confirm-note"
              checked={confirmedNote}
              onCheckedChange={setConfirmedNote}
              prefix="I confirm the note to physician reads:"
              value={draft.note_to_physician || "(none — verify this is correct)"}
            />

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={submitting}
              >
                Back
              </Button>
              <Button type="submit" disabled={!allConfirmed || submitting}>
                {submitting ? "Creating product…" : "Create draft product"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
