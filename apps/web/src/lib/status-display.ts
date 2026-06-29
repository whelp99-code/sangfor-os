/**
 * status-display.ts — Korean status label helpers for UI components.
 *
 * Re-exports STATUS_LABELS from ux-labels.ts and provides a
 * `statusLabel(kind, value)` helper for per-entity lookups.
 */

export { STATUS_LABELS, displayStatus } from './ux-labels'
import { STATUS_LABELS } from './ux-labels'

/**
 * Kind-aware lookup so callers can pass an entity kind hint.
 * Currently all statuses live in one flat map; kind is reserved for
 * future per-entity overrides without a breaking API change.
 *
 * @param kind  - entity kind hint ('opportunity' | 'task' | 'deposit' | ...)
 * @param value - raw internal status string
 * @returns Korean display label, falls back to raw value if not found
 */
export function statusLabel(_kind: string, value: string): string {
  return STATUS_LABELS[value] ?? STATUS_LABELS[value.toLowerCase()] ?? value
}
