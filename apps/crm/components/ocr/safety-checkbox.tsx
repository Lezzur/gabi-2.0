// ui-design §C5 — Friction pattern: the confirmed value appears INSIDE the
// checkbox label, not alongside it. The user must read the exact extracted
// text while ticking. This is intentional — a "confirm" button with a
// separate value display would allow confirmation without reading.

"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SafetyCheckboxProps {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  prefix: string
  value: string
  className?: string
}

export function SafetyCheckbox({
  id,
  checked,
  onCheckedChange,
  prefix,
  value,
  className,
}: SafetyCheckboxProps) {
  return (
    <div className={cn("flex items-start gap-3 p-4 border rounded-md", className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5 shrink-0"
      />
      <Label htmlFor={id} className="text-sm leading-relaxed cursor-pointer">
        {prefix}{" "}
        <strong className="font-semibold break-words">{value}</strong>
      </Label>
    </div>
  )
}
