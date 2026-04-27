import { useEffect, useRef, useState } from 'react'
import * as Network from 'expo-network'
import { supabase } from '../supabase'
import { flushQueue } from './sync'

const POLL_INTERVAL_MS = 10_000

/**
 * Polls expo-network every 10 s and returns the current connectivity state.
 * expo-network has no event listener API in SDK 51, so polling is the
 * supported approach for detecting reconnection.
 */
export function useNetworkStatus(): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync()
        if (!cancelled) setIsConnected(state.isConnected ?? true)
      } catch {
        // On error assume connected to avoid blocking the UI.
      }
    }

    check()
    const timer = setInterval(check, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { isConnected }
}

/**
 * Triggers flushQueue whenever the app transitions from offline → online.
 * Returns a status object the caller can use to show a sync indicator.
 */
export function useSyncOnReconnect(): {
  isSyncing: boolean
  lastSyncResult: { flushed: number; failed: number; dropped: number } | null
} {
  const { isConnected } = useNetworkStatus()
  const wasConnected = useRef(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<{
    flushed: number
    failed: number
    dropped: number
  } | null>(null)

  useEffect(() => {
    const justReconnected = isConnected && !wasConnected.current
    wasConnected.current = isConnected

    if (!justReconnected) return

    let cancelled = false
    setIsSyncing(true)

    flushQueue(supabase)
      .then((result) => {
        if (!cancelled) {
          setLastSyncResult(result)
        }
      })
      .catch(() => {
        // flushQueue does not throw; this catches unexpected errors only.
      })
      .finally(() => {
        if (!cancelled) setIsSyncing(false)
      })

    return () => {
      cancelled = true
    }
  }, [isConnected])

  return { isSyncing, lastSyncResult }
}
