import { profileMenuItems } from '@/config/navigation'

/**
 * Shared user menu for all app shells. Broker-specific controls, including
 * Leverage, are capability-gated inside Connections & Data.
 */
export function useProfileMenuItems() {
  return profileMenuItems
}
