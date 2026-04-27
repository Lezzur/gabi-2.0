"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface ReturnConfirmDialogProps {
  open: boolean
  containerUuid: string
  onConfirm: (conditionOk: boolean) => void
  onCancel: () => void
}

export function ReturnConfirmDialog({
  open,
  containerUuid,
  onConfirm,
  onCancel,
}: ReturnConfirmDialogProps) {
  const [conditionChecked, setConditionChecked] = useState(false)

  function handleConfirm() {
    onConfirm(conditionChecked)
    setConditionChecked(false)
  }

  function handleCancel() {
    setConditionChecked(false)
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Container Return</DialogTitle>
          <DialogDescription>
            Container <span className="font-mono text-xs">{containerUuid.slice(0, 8)}…</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Verify the physical container before accepting the return. Damaged, opened,
            or tampered containers should be rejected.
          </p>
          <div className="flex items-start gap-3 p-3 border rounded-md">
            <Checkbox
              id="condition-ok"
              checked={conditionChecked}
              onCheckedChange={(v) => setConditionChecked(v === true)}
            />
            <Label htmlFor="condition-ok" className="text-sm leading-snug cursor-pointer">
              I confirm the container is in acceptable condition — sealed, undamaged, and
              matches the product label.
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!conditionChecked}>
            Accept Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
