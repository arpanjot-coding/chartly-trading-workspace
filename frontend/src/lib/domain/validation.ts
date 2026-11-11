/** Runtime v1 boundary. No persistence, credentials or broker side effects. */

import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import declarations from '../../../../contracts/v1/rules.json'
import schema from '../../../../contracts/v1/schemas/domain.schema.json'
import timezoneNames from '../../../../contracts/v1/timezones.json'
import type { DomainTypes, RecordType } from './types.generated'

export interface ContractIssue {
  code: string
  path: string
}
export interface ContractEntry {
  type: string
  value: unknown
}
type Obj = Record<string, unknown>
const rules = declarations as {
  references: Record<string, Record<string, string>>
  unique: {
    type: string
    fields: string[]
    where: Record<string, string>
    code: string
    skipMissing?: boolean
    errorField?: string
  }[]
  immutableTypes: string[]
  immutableFields: Record<string, string[]>
  ranges: Record<string, string[]>
  stateMachines: Record<string, Record<string, string[]>>
}
const definitions = schema.$defs as Record<string, { properties?: Obj }>
const recordTypes = new Set(
  Object.entries(definitions)
    .filter(([, def]) => def.properties?.id)
    .map(([name]) => name)
)
const timezones = new Set(timezoneNames)
const object = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const issue = (code: string, path: string): ContractIssue => ({ code, path })
const pointer = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1')
const sorted = (issues: ContractIssue[]): ContractIssue[] =>
  [...new Map(issues.map((e) => [JSON.stringify([e.path, e.code]), e])).values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  )
const instant = (value: string) => {
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$/.test(value) ||
    value.startsWith('0000')
  )
    return false
  const date = new Date(value)
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
  )
}
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  ownProperties: true,
  allowUnionTypes: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
})
ajv.addFormat('trading-date', {
  type: 'string',
  validate: (value: string) => instant(`${value}T00:00:00Z`),
})
ajv.addFormat('utc-instant', { type: 'string', validate: instant })
ajv.addFormat('iana-timezone', {
  type: 'string',
  validate: (value: string) => timezones.has(value),
})
ajv.addSchema(schema)
const validators = new Map<string, ValidateFunction>()

function schemaIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((error) => {
    let path = error.instancePath
    if (error.keyword === 'required') path += `/${pointer(String(error.params.missingProperty))}`
    if (error.keyword === 'additionalProperties')
      path += `/${pointer(String(error.params.additionalProperty))}`
    return issue(`schema.${error.keyword}`, path)
  })
}

/** Returns integer units without floating point or rounding. */
export function decimalUnits(value: string, scale: number): bigint | null {
  if (
    typeof value !== 'string' ||
    !new RegExp(schema.$defs.Decimal.pattern).test(value) ||
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 18
  )
    return null
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  if (fraction.length > scale) return null
  return (value.startsWith('-') ? -1n : 1n) * BigInt(whole + fraction.padEnd(scale, '0'))
}

export function validateRecord(type: string, input: unknown): ContractIssue[] {
  if (!recordTypes.has(type)) return [issue('contract.unknown_type', '')]
  if (object(input) && 'schemaVersion' in input && input.schemaVersion !== 1)
    return [issue('contract.unsupported_version', '/schemaVersion')]
  let validate = validators.get(type)
  if (!validate) {
    validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${type}` })
    validators.set(type, validate)
  }
  if (!validate(input)) return sorted(schemaIssues(validate.errors))
  const value = input as Obj
  const issues: ContractIssue[] = []
  if (Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string))
    issues.push(issue('time.reversed', '/updatedAt'))
  if (type === 'Account') {
    const external = value.kind === 'external'
    if (external !== (value.mode as string).startsWith('broker_'))
      issues.push(issue('account.mode_mismatch', '/mode'))
    for (const key of ['providerId', 'venue', 'externalIdentity']) {
      if (external && !(key in value)) issues.push(issue('account.identity_required', `/${key}`))
      if (!external && key in value) issues.push(issue('account.simulated_identity', `/${key}`))
    }
  }
  if (type === 'JournalBook') {
    if (value.kind === 'manual' && 'accountId' in value)
      issues.push(issue('book.manual_account', '/accountId'))
    if (value.kind !== 'manual' && !('accountId' in value))
      issues.push(issue('book.account_required', '/accountId'))
  }
  if (type === 'CapabilityManifest') {
    for (const [key, capability] of Object.entries(value.capabilities as Record<string, Obj>)) {
      if (
        capability.state === 'supported' &&
        !('evidenceId' in capability && 'verifiedAt' in capability)
      )
        issues.push(issue('capability.evidence_required', `/capabilities/${key}`))
    }
  }
  if (type === 'SourceConnection' && value.health !== 'unknown' && !('observedAt' in value))
    issues.push(issue('source.observation_required', '/observedAt'))
  if (
    (type === 'Listing' || type === 'ProviderSymbol') &&
    'validTo' in value &&
    Date.parse(value.validTo as string) <= Date.parse(value.validFrom as string)
  )
    issues.push(issue('time.invalid_range', '/validTo'))
  if (type === 'Instrument') {
    for (const [field, scale] of [
      ['quantityStep', 'quantityScale'],
      ['priceTick', 'priceScale'],
    ]) {
      if (!(field in value) && !(scale in value)) continue
      const units =
        field in value && scale in value
          ? decimalUnits(value[field] as string, value[scale] as number)
          : null
      if (units === null || units <= 0n) issues.push(issue('decimal.invalid_step', `/${field}`))
    }
    if ('multiplier' in value && decimalUnits(value.multiplier as string, 18)! <= 0n)
      issues.push(issue('decimal.positive_required', '/multiplier'))
  }
  return sorted([...issues, ...recordSemantics(type, value)])
}

function recordSemantics(type: string, value: Obj): ContractIssue[] {
  const issues: ContractIssue[] = []
  const reject = (code: string, field: string) => issues.push(issue(code, `/${field}`))
  const at = (field: string) => Date.parse(value[field] as string)
  if (type === 'EventEnvelope') {
    if (['account', 'paper'].includes(value.contextKind as string)) {
      for (const field of ['accountId', 'mode', 'sourceId'])
        if (!(field in value)) reject('envelope.account_context_required', field)
      if (value.contextKind === 'paper' && !('runId' in value))
        reject('envelope.account_context_required', 'runId')
    } else if ('accountId' in value || 'mode' in value || 'runId' in value)
      reject('envelope.account_context_forbidden', 'contextKind')
  }
  if (type in rules.ranges) {
    const [start, end] = rules.ranges[type]
    if (at(start) >= at(end)) reject('time.invalid_range', end)
  }
  if (['DocumentVersion', 'FactObservation'].includes(type)) {
    if (at('publishedAt') > at('availableAt')) reject('research.availability_order', 'availableAt')
    if (at('availableAt') > at('retrievedAt')) reject('research.availability_order', 'retrievedAt')
  }
  if (type === 'FactObservation') {
    if (value.unit === 'currency' && !('currency' in value))
      reject('research.currency_required', 'currency')
    if (value.periodKind === 'duration' && !('periodStart' in value))
      reject('research.period_start_required', 'periodStart')
    if (value.periodKind === 'instant' && 'periodStart' in value)
      reject('research.instant_period', 'periodStart')
    if ('periodStart' in value && (value.periodStart as string) > (value.periodEnd as string))
      reject('time.invalid_range', 'periodEnd')
  }
  if (['DerivedMetric', 'MetricResult'].includes(type)) {
    if ('value' in value === 'unavailableReason' in value)
      reject('metric.value_or_unavailable', 'value')
    if (value.unit === 'currency' && !('currency' in value))
      reject('metric.currency_required', 'currency')
    if (type === 'MetricResult' && value.sampleSize === 0 && 'value' in value)
      reject('metric.empty_sample', 'value')
  }
  if (type === 'OrderIntent') {
    for (const [orderType, field] of [
      ['limit', 'limitPrice'],
      ['stop', 'stopPrice'],
    ]) {
      if (value.orderType === orderType && !(field in value)) reject('order.price_required', field)
      if (field in value && decimalUnits(value[field] as string, 18)! <= 0n)
        reject('decimal.positive_required', field)
    }
    if (value.mode === 'paper_replay' && ('destinationId' in value || !('runId' in value)))
      reject('mode.paper_run_required', 'runId')
    if (
      (value.mode as string).startsWith('broker_') &&
      (!('destinationId' in value) || 'runId' in value)
    )
      reject('mode.broker_destination_required', 'destinationId')
  }
  if (['TradeAggregate', 'ManualTrade'].includes(type)) {
    if (value.status === 'closed' && !('closedAt' in value))
      reject('trade.close_time_required', 'closedAt')
    if (value.status === 'open' && 'closedAt' in value) reject('trade.open_close_time', 'closedAt')
    if ('closedAt' in value && at('closedAt') < at('openedAt'))
      reject('time.invalid_range', 'closedAt')
    if (type === 'TradeAggregate') {
      if (!value.feesKnown && 'netPnl' in value) reject('trade.unknown_fees', 'netPnl')
      if (!(value.fillIds as string[]).length) reject('trade.fills_required', 'fillIds')
    }
  }
  if (type === 'JournalEntry' && 'manualTradeId' in value === 'tradeId' in value)
    reject('journal.exactly_one_trade', 'tradeId')
  if (type === 'Experiment' && at('warmupStart') > at('rangeStart'))
    reject('experiment.invalid_warmup', 'warmupStart')
  if (type === 'EvaluationSplit') {
    for (const [start, end, allowEqual] of [
      ['trainingStart', 'trainingEnd', false],
      ['trainingEnd', 'validationStart', true],
      ['validationStart', 'validationEnd', false],
      ['validationEnd', 'holdoutStart', true],
      ['holdoutStart', 'holdoutEnd', false],
    ] as const) {
      if (at(start) > at(end) || (!allowEqual && at(start) === at(end)))
        reject('experiment.overlapping_split', end)
    }
  }
  if (type === 'SourceCoverage') {
    const gaps = value.gaps as { start: string; end: string }[]
    if (value.status === 'complete' && (!('evidenceId' in value) || gaps.length > 0))
      reject('coverage.unproven_complete', 'status')
    gaps.forEach((gap, i) => {
      if (
        !(
          at('rangeStart') <= Date.parse(gap.start) &&
          Date.parse(gap.start) < Date.parse(gap.end) &&
          Date.parse(gap.end) <= at('rangeEnd')
        )
      )
        reject('coverage.invalid_gap', `gaps/${i}`)
    })
  }
  if (
    type === 'ReconciliationConflict' &&
    value.status !== 'unresolved' &&
    !('resolutionReceiptId' in value)
  )
    reject('reconciliation.receipt_required', 'resolutionReceiptId')
  if (type === 'ScopedQuery' && value.currencyPolicy === 'converted') {
    for (const field of ['reportingCurrency', 'conversionSourceId', 'asOf'])
      if (!(field in value)) reject('query.conversion_provenance', field)
  }
  return issues
}

export function validateRecords(input: unknown): ContractIssue[] {
  if (!Array.isArray(input)) return [issue('collection.array_required', '')]
  if (input.length > 10000) return [issue('collection.limit', '')]
  const issues: ContractIssue[] = []
  input.forEach((entry: unknown, i) => {
    if (
      !object(entry) ||
      Object.keys(entry).sort().join(',') !== 'type,value' ||
      typeof entry.type !== 'string'
    )
      issues.push(issue('collection.entry_invalid', `/${i}`))
    else
      issues.push(
        ...validateRecord(entry.type, entry.value).map((error) =>
          issue(error.code, `/${i}/value${error.path}`)
        )
      )
  })
  if (issues.length) return sorted(issues)
  const entries = input as { type: string; value: Obj }[]
  const index = new Map<string, { type: string; value: Obj }>()
  entries.forEach((entry, i) => {
    const id = entry.value.id as string
    if (index.has(id)) issues.push(issue('identity.duplicate_id', `/${i}/value/id`))
    else index.set(id, entry)
  })
  entries.forEach(({ type, value }, i) => {
    const refs = { ...rules.references[type] }
    if (type !== 'LocalOwner') refs.ownerId = 'LocalOwner'
    if (!['LocalOwner', 'Workspace'].includes(type)) refs.workspaceId = 'Workspace'
    for (const [field, targetType] of Object.entries(refs)) {
      const raw = value[field] ?? []
      for (const id of Array.isArray(raw) ? raw : [raw]) {
        const target = index.get(id as string)
        const path = `/${i}/value/${field}`
        if (!target || target.type !== targetType) {
          issues.push(issue('reference.missing', path))
          continue
        }
        if (targetType !== 'LocalOwner' && target.value.ownerId !== value.ownerId)
          issues.push(issue('scope.owner_mismatch', path))
        if (
          !['LocalOwner', 'Workspace'].includes(targetType) &&
          target.value.workspaceId !== value.workspaceId
        )
          issues.push(issue('scope.workspace_mismatch', path))
      }
    }
    if (type === 'JournalBook' && 'accountId' in value) {
      const account = index.get(value.accountId as string)
      if (account?.type === 'Account') {
        if ((value.kind === 'connected') !== (account.value.kind === 'external'))
          issues.push(issue('book.account_kind', `/${i}/value/accountId`))
        if (account.value.currency !== value.currency)
          issues.push(issue('book.account_currency', `/${i}/value/currency`))
      }
    }
    if (type === 'Profile' && 'primaryBookId' in value && 'primaryAccountId' in value) {
      const book = index.get(value.primaryBookId as string)
      if (book?.type === 'JournalBook' && book.value.accountId !== value.primaryAccountId)
        issues.push(issue('profile.account_book_mismatch', `/${i}/value/primaryAccountId`))
    }
    if (type === 'Quantity') {
      const instrument = index.get(value.instrumentId as string)
      if (instrument?.type === 'Instrument') {
        const meta = instrument.value
        if (!['quantityScale', 'quantityStep', 'quantityUnit'].every((field) => field in meta)) {
          issues.push(issue('instrument.economics_unavailable', `/${i}/value/instrumentId`))
        } else {
          const units = decimalUnits(value.value as string, meta.quantityScale as number)
          const step = decimalUnits(meta.quantityStep as string, meta.quantityScale as number)
          if (value.unit !== meta.quantityUnit)
            issues.push(issue('quantity.unit_mismatch', `/${i}/value/unit`))
          if (units === null || units <= 0n || step === null || step === 0n || units % step !== 0n)
            issues.push(issue('quantity.invalid_step', `/${i}/value/value`))
        }
      }
    }
    issues.push(
      ...graphSemantics(type, value, index).map((e) => issue(e.code, `/${i}/value${e.path}`))
    )
  })
  for (const rule of rules.unique) {
    const seen = new Set<string>()
    entries.forEach(({ type, value }, i) => {
      if (
        type !== rule.type ||
        !Object.entries(rule.where).every(([key, expected]) => value[key] === expected)
      )
        return
      if (rule.skipMissing && !rule.fields.every((field) => field in value)) return
      const key = JSON.stringify(
        ['ownerId', 'workspaceId', ...rule.fields].map((key) => value[key] ?? null)
      )
      if (seen.has(key))
        issues.push(issue(rule.code, `/${i}/value/${rule.errorField ?? rule.fields[0]}`))
      seen.add(key)
    })
  }
  return sorted([...issues, ...collectionSemantics(entries, index)])
}

function collectionSemantics(
  entries: { type: string; value: Obj }[],
  index: Map<string, { type: string; value: Obj }>
): ContractIssue[] {
  const issues: ContractIssue[] = []
  const positions = new Map(entries.map((e, i) => [e.value.id as string, i]))
  const colors = new Map<string, number>()
  for (const rootId of [...index.keys()].sort()) {
    if (index.get(rootId)?.type !== 'ArtifactRevision' || colors.get(rootId)) continue
    colors.set(rootId, 1)
    const stack = [{ id: rootId, edge: 0 }]
    while (stack.length) {
      const node = stack[stack.length - 1]
      const deps = index.get(node.id)!.value.dependencies as { revisionId: string }[]
      if (node.edge >= deps.length) {
        colors.set(node.id, 2)
        stack.pop()
        continue
      }
      const edge = node.edge++
      const targetId = deps[edge].revisionId
      if (index.get(targetId)?.type !== 'ArtifactRevision') continue
      if (colors.get(targetId) === 1)
        issues.push(
          issue(
            'artifact.dependency_cycle',
            `/${positions.get(node.id)}/value/dependencies/${edge}/revisionId`
          )
        )
      else if (!colors.get(targetId)) {
        colors.set(targetId, 1)
        stack.push({ id: targetId, edge: 0 })
      }
    }
  }
  const windows = new Map<string, { start: number; end: number }[]>()
  entries.forEach(({ type, value }, i) => {
    if (type !== 'ProviderSymbol') return
    const key = JSON.stringify([value.ownerId, value.workspaceId, value.sourceId, value.symbol])
    const start = Date.parse(value.validFrom as string)
    const end = 'validTo' in value ? Date.parse(value.validTo as string) : Infinity
    const existing = windows.get(key) ?? []
    for (const other of existing)
      if (other.start < end && start < other.end)
        issues.push(issue('symbol.overlapping_alias', `/${i}/value/validFrom`))
    existing.push({ start, end })
    windows.set(key, existing)
  })
  return issues
}

function graphSemantics(
  type: string,
  value: Obj,
  index: Map<string, { type: string; value: Obj }>
): ContractIssue[] {
  const issues: ContractIssue[] = []
  const reject = (code: string, field: string) => issues.push(issue(code, `/${field}`))
  const lookup = (field: string, expected?: string): Obj | undefined => {
    const result = index.get(value[field] as string)
    return result && (!expected || result.type === expected) ? result.value : undefined
  }
  const account = lookup('accountId', 'Account')
  if (account && 'mode' in value && account.mode !== value.mode)
    reject('mode.account_mismatch', 'mode')
  if (account)
    for (const field of [
      'intentId',
      'commandId',
      'fillId',
      'destinationId',
      'runId',
      'sourceId',
      'correctsFillId',
      'correctsObservationId',
    ]) {
      const target = lookup(field)
      if (target && 'accountId' in target && target.accountId !== value.accountId)
        reject('scope.account_mismatch', field)
    }
  if (['ExecutionFill', 'SourceObservation'].includes(type)) {
    const source = lookup('sourceId', 'SourceConnection')
    if (source && source.providerId !== value.providerId)
      reject('source.provider_mismatch', 'providerId')
  }
  if (['ExecutionFill', 'OrderIntent'].includes(type) && 'decisionId' in value) {
    const decision = lookup('decisionId', 'Decision')
    if (decision && !(decision.accountIds as string[]).includes(value.accountId as string))
      reject('decision.account_scope', 'decisionId')
  }
  if (type === 'CapabilityManifest') {
    const source = lookup('sourceId', 'SourceConnection')
    if (source) {
      if (source.adapterVersion !== value.adapterVersion)
        reject('capability.adapter_mismatch', 'adapterVersion')
      const bound = index.get(source.accountId as string)
      if (bound?.type === 'Account' && value.environment !== bound.value.mode)
        reject('mode.account_mismatch', 'environment')
    }
    if (value.environment === 'data_only')
      for (const key of ['orderSubmit', 'orderCancel', 'protectiveOrders']) {
        if ((value.capabilities as Record<string, Obj>)[key]?.state === 'supported')
          reject('capability.data_only_write', `capabilities/${key}`)
      }
  }
  if (type === 'ExecutionDestination') {
    const manifest = lookup('manifestId', 'CapabilityManifest')
    if (manifest && (manifest.sourceId !== value.sourceId || manifest.environment !== value.mode))
      reject('destination.manifest_mismatch', 'manifestId')
  }
  if (['JournalEntry', 'ManualTrade', 'Review'].includes(type)) {
    const book = lookup('bookId', 'JournalBook')
    if (book) {
      if (type === 'ManualTrade' && book.kind !== 'manual')
        reject('journal.manual_book_required', 'bookId')
      if (type === 'JournalEntry') {
        const manual = lookup('manualTradeId', 'ManualTrade'),
          trade = lookup('tradeId', 'TradeAggregate')
        if (manual && (book.kind !== 'manual' || manual.bookId !== value.bookId))
          reject('journal.book_mismatch', 'manualTradeId')
        if (trade && book.accountId !== trade.accountId) reject('journal.book_mismatch', 'tradeId')
      }
      if (type === 'Review') {
        const trade = lookup('tradeId', 'TradeAggregate')
        if (trade && book.accountId !== trade.accountId) reject('journal.book_mismatch', 'tradeId')
      }
    }
  }
  if (['ExecutionFill', 'OrderIntent'].includes(type)) {
    const instrument = lookup('instrumentId', 'Instrument')
    if (instrument) {
      if (
        ![
          'quantityScale',
          'quantityStep',
          'quantityUnit',
          'priceScale',
          'priceTick',
          'multiplier',
          'calendarId',
          'timezone',
        ].every((field) => field in instrument)
      ) {
        reject('instrument.economics_unavailable', 'instrumentId')
        return issues
      }
      const quantity = value.quantity as { value: string; unit: string }
      const units = decimalUnits(quantity.value, instrument.quantityScale as number)
      const step = decimalUnits(
        instrument.quantityStep as string,
        instrument.quantityScale as number
      )
      if (quantity.unit !== instrument.quantityUnit)
        reject('quantity.unit_mismatch', 'quantity/unit')
      if (units === null || units <= 0n || !step || units % step !== 0n)
        reject('quantity.invalid_step', 'quantity/value')
      if (type === 'ExecutionFill') {
        const price = decimalUnits(value.price as string, instrument.priceScale as number)
        const tick = decimalUnits(instrument.priceTick as string, instrument.priceScale as number)
        if (price === null || price <= 0n || !tick || price % tick !== 0n)
          reject('price.invalid_tick', 'price')
        if (value.currency !== instrument.quoteCurrency)
          reject('price.currency_mismatch', 'currency')
      }
    }
  }
  for (const field of ['fillIds', 'observationIds'])
    if ('accountId' in value) {
      for (const targetId of (value[field] ?? []) as string[]) {
        const target = index.get(targetId)
        if (target && target.value.accountId !== value.accountId)
          reject('scope.account_mismatch', field)
      }
    }
  if (['RunManifest', 'Experiment'].includes(type)) {
    const dataset = lookup('datasetVersionId', 'DatasetVersion')
    if (dataset) {
      if (dataset.instrumentId !== value.instrumentId)
        reject('dataset.instrument_mismatch', 'instrumentId')
      if (
        !(
          Date.parse(dataset.rangeStart as string) <= Date.parse(value.rangeStart as string) &&
          Date.parse(value.rangeStart as string) < Date.parse(value.rangeEnd as string) &&
          Date.parse(value.rangeEnd as string) <= Date.parse(dataset.rangeEnd as string)
        )
      )
        reject('dataset.range_uncovered', 'rangeEnd')
      if (dataset.quality !== 'verified') reject('dataset.unverified', 'datasetVersionId')
    }
    if (type === 'RunManifest') {
      const book = lookup('bookId', 'JournalBook')
      if (book && (book.kind !== 'paper' || book.accountId !== value.accountId))
        reject('run.book_mismatch', 'bookId')
    }
  }
  if (
    ['IndicatorAttachment', 'Experiment', 'DeploymentRevision', 'ValidationRecord'].includes(type)
  ) {
    const parameters = lookup('parameterSetId', 'ParameterSet')
    if (parameters && parameters.artifactRevisionId !== value.artifactRevisionId)
      reject('artifact.parameter_revision_mismatch', 'parameterSetId')
    const revision = lookup('artifactRevisionId', 'ArtifactRevision')
    if (
      revision &&
      ['Experiment', 'DeploymentRevision'].includes(type) &&
      revision.kind !== 'strategy'
    )
      reject('artifact.strategy_required', 'artifactRevisionId')
    if (revision && type === 'IndicatorAttachment' && revision.kind !== 'indicator')
      reject('artifact.indicator_required', 'artifactRevisionId')
    if (type === 'ValidationRecord')
      for (const experimentId of value.experimentIds as string[]) {
        const target = index.get(experimentId)
        if (
          target?.type === 'Experiment' &&
          ['artifactRevisionId', 'parameterSetId'].some((k) => target.value[k] !== value[k])
        )
          reject('artifact.evidence_mismatch', 'experimentIds')
      }
  }
  if (type === 'ArtifactRevision') {
    const project = lookup('projectId', 'ArtifactProject')
    if (project && (project.kind !== value.kind || project.language !== value.language))
      reject('artifact.project_mismatch', 'projectId')
    for (const [i, dependency] of (
      value.dependencies as { revisionId: string; checksum: string }[]
    ).entries()) {
      const target = index.get(dependency.revisionId)
      if (!target || target.type !== 'ArtifactRevision')
        reject('reference.missing', `dependencies/${i}/revisionId`)
      else if (
        target.value.ownerId !== value.ownerId ||
        target.value.workspaceId !== value.workspaceId
      )
        reject('scope.owner_mismatch', `dependencies/${i}/revisionId`)
      else if (target.value.checksum !== dependency.checksum || dependency.revisionId === value.id)
        reject('artifact.dependency_mismatch', `dependencies/${i}/checksum`)
    }
  }
  if (type === 'NotebookSnapshot') {
    for (const field of ['documentVersionIds', 'factIds', 'derivedMetricIds'])
      for (const targetId of value[field] as string[]) {
        const target = index.get(targetId)
        if (
          target &&
          'availableAt' in target.value &&
          Date.parse(target.value.availableAt as string) > Date.parse(value.asOf as string)
        )
          reject('research.future_evidence', field)
      }
  }
  if (type === 'FactObservation') {
    const document = lookup('documentVersionId', 'DocumentVersion')
    if (document && document.issuerId !== value.issuerId)
      reject('research.issuer_mismatch', 'documentVersionId')
    if (
      document &&
      Date.parse(document.availableAt as string) > Date.parse(value.availableAt as string)
    )
      reject('research.future_evidence', 'documentVersionId')
    const previous = lookup('revisesFactId', 'FactObservation')
    if (
      previous &&
      ['issuerId', 'metricId', 'periodKind', 'periodEnd'].some((k) => previous[k] !== value[k])
    )
      reject('research.revision_mismatch', 'revisesFactId')
  }
  if (type === 'DerivedMetric')
    for (const factId of value.inputFactIds as string[]) {
      const target = index.get(factId)
      if (target?.type === 'FactObservation') {
        if (target.value.issuerId !== value.issuerId)
          reject('research.issuer_mismatch', 'inputFactIds')
        if (
          Date.parse(target.value.availableAt as string) > Date.parse(value.availableAt as string)
        )
          reject('research.future_evidence', 'inputFactIds')
      }
    }
  if (type === 'Checkpoint') {
    const run = lookup('runId', 'RunManifest')
    if (
      run &&
      !(
        Date.parse(run.rangeStart as string) <= Date.parse(value.playhead as string) &&
        Date.parse(value.playhead as string) <= Date.parse(run.rangeEnd as string)
      )
    )
      reject('run.playhead_outside_range', 'playhead')
  }
  if (type === 'DeploymentRevision') {
    const destination = lookup('destinationId', 'ExecutionDestination')
    if (destination && destination.mode !== value.mode) reject('mode.account_mismatch', 'mode')
  }
  if (['CommandEnvelope', 'EventEnvelope'].includes(type)) {
    const target = lookup('payloadId', value.payloadType as string)
    if (!target) reject('reference.missing', 'payloadId')
    else {
      for (const key of ['accountId', 'mode', 'ownerId', 'workspaceId'])
        if (key in target && target[key] !== value[key])
          reject('envelope.scope_mismatch', 'payloadId')
      if (
        type === 'EventEnvelope' &&
        'accountId' in target &&
        !['account', 'paper'].includes(value.contextKind as string)
      )
        reject('envelope.account_context_required', 'contextKind')
    }
  }
  return issues
}

export function validateTransition(
  machine: string,
  before: string,
  after: string,
  context: { manifestValid?: boolean; eligible?: boolean; approved?: boolean } = {}
): ContractIssue[] {
  if (
    ![machine, before, after].every((value) => typeof value === 'string') ||
    !Object.hasOwn(rules.stateMachines, machine)
  )
    return [issue('transition.unknown_state', '')]
  const graph = rules.stateMachines[machine]
  if (!graph || !Object.hasOwn(graph, before) || !Object.hasOwn(graph, after))
    return [issue('transition.unknown_state', '')]
  if (!graph[before].includes(after)) return [issue('transition.forbidden', '')]
  if (
    machine === 'run' &&
    ['ready', 'in_progress'].includes(after) &&
    context.manifestValid !== true
  )
    return [issue('transition.manifest_required', '')]
  if (
    machine === 'arming' &&
    after === 'armed' &&
    !(context.eligible === true && context.approved === true)
  )
    return [issue('transition.approval_required', '')]
  return []
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export function validateReplacement(
  type: string,
  previous: unknown,
  proposed: unknown
): ContractIssue[] {
  const issues = [...validateRecord(type, previous), ...validateRecord(type, proposed)]
  if (issues.length) return sorted(issues)
  if (stable(previous) === stable(proposed)) return []
  if (rules.immutableTypes.includes(type)) return [issue('revision.immutable', '')]
  const before = previous as Obj,
    after = proposed as Obj
  for (const field of [
    'id',
    'ownerId',
    'workspaceId',
    'createdAt',
    ...(rules.immutableFields[type] ?? []),
  ]) {
    if (stable(before[field]) !== stable(after[field]))
      issues.push(issue('revision.identity_changed', `/${field}`))
  }
  if (after.revision !== (before.revision as number) + 1)
    issues.push(issue('revision.conflict', '/revision'))
  if (Date.parse(after.updatedAt as string) < Date.parse(before.updatedAt as string))
    issues.push(issue('time.reversed', '/updatedAt'))
  return sorted(issues)
}

export function parseRecord<T extends RecordType>(type: T, input: unknown): DomainTypes[T] {
  const issues = validateRecord(type, input)
  if (issues.length)
    throw Object.assign(new Error('Invalid domain contract'), { code: 'contract.invalid', issues })
  return structuredClone(input) as DomainTypes[T]
}
