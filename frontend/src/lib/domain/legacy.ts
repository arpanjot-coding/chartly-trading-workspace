/** Classification only. This module never writes records or guesses an account. */
import policy from '../../../../contracts/v1/legacy-policy.json'

const legacyId = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= policy.maxLegacyId

export function legacyAlias(
  originNamespace: string,
  table: string,
  id: number
): { namespace: string; key: string } {
  if (
    typeof originNamespace !== 'string' ||
    originNamespace.length < 1 ||
    originNamespace.length > 200 ||
    originNamespace.includes(':')
  )
    throw new Error('legacy.origin_namespace_required')
  if (!policy.tables.includes(table) || !legacyId(id)) throw new Error('legacy.invalid_identity')
  return { namespace: `ChartlyTraderDB:${originNamespace}:${table}`, key: String(id) }
}

export function classifyLegacyTrade(input: unknown): { state: string; reason: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { state: 'invalid', reason: 'legacy.invalid_identity' }
  const value = input as Record<string, unknown>
  if (!legacyId(value.id) || !legacyId(value.portfolioId))
    return { state: 'invalid', reason: 'legacy.invalid_identity' }
  for (const field of ['accountId', 'sessionId'])
    if (field in value && !legacyId(value[field]))
      return { state: 'invalid', reason: 'legacy.invalid_reference' }
  if (value.origin === 'manual' && !('accountId' in value) && !('sessionId' in value))
    return { state: 'manual', reason: 'legacy.explicit_manual' }
  if (
    typeof value.origin === 'string' &&
    policy.paperOrigins.includes(value.origin) &&
    !('accountId' in value)
  )
    return { state: 'needs_practice_mapping', reason: 'legacy.dataset_run_unverified' }
  if (
    typeof value.origin === 'string' &&
    policy.externalOrigins.includes(value.origin) &&
    'accountId' in value
  )
    return { state: 'needs_account_verification', reason: 'legacy.account_unverified' }
  return { state: 'needs_classification', reason: 'legacy.ambiguous_provenance' }
}
