import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface OcrConfidenceBadgeProps {
  confidence: number | null | undefined
  className?: string
}

export function OcrConfidenceBadge({ confidence, className }: OcrConfidenceBadgeProps) {
  if (confidence == null) return null

  const pct = Math.round(confidence * 100)

  if (confidence < 0.5) {
    return (
      <Badge variant="destructive" className={cn("text-xs font-mono", className)}>
        {pct}% — Low
      </Badge>
    )
  }
  if (confidence < 0.7) {
    return (
      <Badge className={cn("text-xs font-mono bg-amber-500 text-white hover:bg-amber-500", className)}>
        {pct}% — Review
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className={cn("text-xs font-mono", className)}>
      {pct}%
    </Badge>
  )
}

export function confidenceHighlight(confidence: number | null | undefined): string {
  if (confidence == null) return ""
  if (confidence < 0.5) return "border-destructive bg-destructive/5"
  if (confidence < 0.7) return "border-amber-400 bg-amber-50"
  return ""
}
