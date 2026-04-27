// Service-worker bypass: this page must never be cached offline.
// Dealer scans require a live server-side check — stale responses are invalid.
export const dynamic = "force-dynamic"
export const revalidate = 0

import { ScanTerminal } from "./scan-terminal"

export default function ScanPage() {
  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scan Terminal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Point-of-sale purchase initiation and container return acceptance.
        </p>
      </div>
      <ScanTerminal />
    </div>
  )
}
