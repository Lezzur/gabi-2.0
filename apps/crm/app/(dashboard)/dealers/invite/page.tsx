"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Send } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

// ─── Schema ───────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Must be a valid email address")
    .max(320),
  business_name: z
    .string()
    .min(1, "Business name is required")
    .max(255, "Business name must be under 255 characters"),
  territory_notes: z
    .string()
    .max(1000, "Territory notes must be under 1000 characters"),
  phone_number: z
    .string()
    .refine(
      v => !v || /^\+[1-9]\d{6,14}$/.test(v),
      "Phone must be in E.164 format (e.g. +639171234567)",
    ),
})

type InviteFormValues = z.infer<typeof inviteSchema>

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InviteDealerPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      business_name: "",
      territory_notes: "",
      phone_number: "",
    },
  })

  async function onSubmit(values: InviteFormValues) {
    setSubmitting(true)
    try {
      const body: Record<string, string> = {
        email: values.email,
        business_name: values.business_name,
      }
      if (values.territory_notes) body.territory_notes = values.territory_notes
      if (values.phone_number) body.phone_number = values.phone_number

      const res = await fetch("/api/dealers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const json = await res.json()

      if (res.status === 409) {
        form.setError("email", { message: "This email is already registered" })
        return
      }

      if (res.status === 400) {
        const details: Array<{ field: string; issue: string }> = json.error?.details ?? []
        for (const d of details) {
          if (
            d.field === "email" ||
            d.field === "business_name" ||
            d.field === "territory_notes" ||
            d.field === "phone_number"
          ) {
            form.setError(d.field as keyof InviteFormValues, { message: d.issue })
          }
        }
        if (!details.length) toast.error("Validation failed — please check your inputs")
        return
      }

      if (!res.ok) {
        toast.error("Failed to send invite — please try again")
        return
      }

      toast.success(`Invite sent to ${values.email}`)
      router.push("/dealers")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10 space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0 mt-0.5">
          <Link href="/dealers">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to dealers</span>
          </Link>
        </Button>
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Invite Dealer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a magic-link invite to a new dealer. The invite is delivered via email only.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Dealer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address *</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="dealer@agriparts.ph"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="business_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Agri-Parts Tarlac" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="territory_notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Territory notes</FormLabel>
                    <FormControl>
                      <Input placeholder="Central Luzon — Tarlac, Pangasinan" {...field} />
                    </FormControl>
                    <FormDescription>Optional — territory or region covered.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone number</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="+639171234567" {...field} />
                    </FormControl>
                    <FormDescription>Optional — E.164 format (e.g. +639171234567).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={submitting} className="w-full">
                <Send className="mr-2 h-4 w-4" />
                {submitting ? "Sending invite…" : "Send Invite"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
