"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type JobStatus = "idle" | "uploading" | "processing" | "done" | "error"

export default function OcrUploadPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<JobStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return

    setError(null)
    setStatus("uploading")

    try {
      // Step 1: create OCR job + get signed upload URL
      const initRes = await fetch("/api/products/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      })
      if (!initRes.ok) throw new Error("Failed to initialise OCR job")
      const { job_id, upload_url } = (await initRes.json()) as { job_id: string; upload_url: string }

      // Step 2: upload image to Supabase Storage
      const uploadRes = await fetch(upload_url, { method: "PUT", body: file })
      if (!uploadRes.ok) throw new Error("Image upload failed")

      setStatus("processing")

      // Step 3: poll for job completion (max 60 s, every 2 s)
      const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"]!
      const supabaseKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!
      let attempts = 0
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000))
        const pollRes = await fetch(
          `${supabaseUrl}/rest/v1/ocr_jobs?id=eq.${job_id}&select=status,result`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
        )
        const rows = (await pollRes.json()) as { status: string }[]
        const row = rows[0]
        if (row?.status === "completed") {
          setStatus("done")
          router.push(`/products/new/ocr/review?job_id=${job_id}`)
          return
        }
        if (row?.status === "failed") throw new Error("OCR processing failed")
        attempts++
      }
      throw new Error("OCR timed out — try again with a clearer image")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStatus("error")
    }
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <Card>
        <CardHeader>
          <CardTitle>New Product — Upload Label</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Upload a photo of the product label. The OCR engine will extract the fields
              for your review before anything is saved.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              required
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80 cursor-pointer"
            />

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              disabled={status === "uploading" || status === "processing"}
            >
              {status === "uploading" && "Uploading…"}
              {status === "processing" && "Processing OCR…"}
              {(status === "idle" || status === "error") && "Scan label"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
