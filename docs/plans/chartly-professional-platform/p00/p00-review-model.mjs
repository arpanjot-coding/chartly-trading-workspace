/** Fictional P00 walkthrough fixtures. No network, production storage or order APIs. */
export const scenarios = [
  { id: 'import', name: 'Journal: malformed statement → correct → import receipt → review' },
  { id: 'sync', name: 'Journal: cached records → limited sync → correction → offline/reopen' },
  { id: 'paper', name: 'Paper: missing data → return to run → fills → checkpoint → journal' },
  { id: 'strategy', name: 'Strategy: revision → data → saved report → draft edit → paper deployment' },
  { id: 'research', name: 'Fundamentals: save evidence → outage → refresh → mapped chart → return' },
  { id: 'unknown', name: 'Connected activity: unknown submission → reconcile → confirmed fill' },
  { id: 'automation', name: 'Automation: read-only scope → validate → activate → deduplicated run' },
]
const copy = value => structuredClone(value)
const fail = message => { throw new Error(message) }
const requireThat = (test, message) => { if (!test) fail(message) }
const time = '2026-10-01T10:00:00Z'

export function createReviewSession(kind) {
  requireThat(scenarios.some(s => s.id === kind), 'Unknown design scenario')
  const s = { fixtureOnly: true, kind, screen: 'WS09', step: 'ready', history: [], notice: '', scope: {}, changed: 0 }
  if (kind === 'import') Object.assign(s, { screen:'WS11', step:'preview', scope:{bookId:'book-A',accountId:'account-A'}, records:{'EXIST-100':{netMinor:900,review:'Keep my London-session review'}}, rows:[{externalId:'NEW-101',quantity:1,netMinor:800},{externalId:'EXIST-100',quantity:1,netMinor:900},{externalId:'NEW-102',quantity:null,netMinor:-400}], receipt:null })
  if (kind === 'sync') Object.assign(s, { screen:'WS12', step:'cached', scope:{bookId:'book-A',accountId:'account-A'}, engine:false, jobs:[], records:{'EXEC-100':{netMinor:900,review:'Keep my London-session review'}}, sourceObservations:['source-A:100'],coverage:'unknown',cursor:null })
  if (kind === 'paper') Object.assign(s, { screen:'WS06', step:'data-needed', scope:{runId:'P1',bookId:'paper-book-P1',accountId:'sim-P1',instrumentId:'BTCUSD-spot',returnTo:'WS06/P1'}, dataset:null,clock:0,cashMinor:100000,position:0,pending:null,fills:[],journal:[],checkpoint:null })
  if (kind === 'strategy') Object.assign(s, { screen:'SB02', step:'indicator', scope:{projectId:'project-1'}, kindOfArtifact:'Indicator',draft:'draft-1',revision:'r1',params:{fast:10,slow:20},dataset:null,experiments:[],deployment:null,chartOpen:true })
  if (kind === 'research') Object.assign(s, { screen:'FND02', step:'company', scope:{issuerId:'issuer-AST',listingId:'AST-XTEST',returnTo:'FND08/N1'}, fact:{revision:'F1',value:'1200000',currency:'USD',publishedAt:'2026-03-01T09:00:00Z',availableAt:'2026-03-01T09:00:00Z'},snapshot:null,note:'Why did reported revenue change?',freshness:'current',mapping:null })
  if (kind === 'unknown') Object.assign(s, { screen:'WS05', step:'unknown', scope:{operationId:'I1',accountId:'account-A',bookId:'book-A'},orderStatus:'unknown',fills:[],journal:[] })
  if (kind === 'automation') Object.assign(s, { screen:'AUTO02',step:'draft',scope:{workflowId:'flow-1',accountId:'account-A',bookId:'book-A'},nodes:['history','notify'],capabilities:['account-history'],validated:false,active:false,runs:[] })
  return s
}

export function importCounts(s) {
  let invalid=0,duplicate=0,valid=0;const seen=new Set(Object.keys(s.records))
  for(const row of s.rows){if(!row.externalId||!(Number.isFinite(row.quantity)&&row.quantity>0)){invalid++;continue}if(seen.has(row.externalId)){duplicate++;continue}seen.add(row.externalId);valid++}
  return { invalid, duplicate, valid }
}

export function canUseFactAsOf(fact, asOf) {
  return !!fact.availableAt && Number.isFinite(Date.parse(fact.availableAt)) && Date.parse(fact.availableAt)<=Date.parse(asOf)
}

export function parameterGrid() {
  return [10,20,30].flatMap(fast=>[20,40,60].map(slow=>({fast,slow,accepted:fast<slow})))
}

export function resolveConnectedBook(books, accountId) {
  requireThat(!!accountId,'Verify a canonical account identity first')
  const active=books.filter(b=>b.kind==='connected'&&b.accountId===accountId&&!b.archived)
  requireThat(active.length<=1,'Conflicting active books require migration review; do not guess')
  return active.length?{action:'open-existing',bookId:active[0].id}:{action:'create-connected',accountId}
}

export function validateSourceBook(book, accountId) {
  requireThat(book.kind==='connected','Manual and paper books cannot be silently rebound to an external account')
  requireThat(!!accountId&&book.accountId===accountId,'Source account does not match this book')
  return true
}

export function reviewActions(s) {
  const map = {
    import: [['fix-row','Correct row 3 quantity'],['commit','Commit validated import'],['open-journal','Review this book']],
    sync: [['start-engine','Open local engine / resume catch-up'],['refresh','Apply verified overlapping source correction'],['limited-history','Inspect limited history coverage'],['close-engine','Close local engine'],['open-journal','Open cached journal']],
    paper: [['choose-data','Choose saved data'],['pick-compatible','Select D1 and return to run P1'],['start','Start paper run'],['paper-buy','Queue paper buy'],['advance','Advance one historical bar'],['paper-sell','Queue paper sell'],['checkpoint','Save fixture checkpoint'],['finish','Finish and review paper journal']],
    strategy: [['make-strategy','Add explicit strategy rules'],['choose-data','Select dataset D1'],['run','Save baseline experiment E1'],['edit-draft','Edit a new draft'],['prepare-paper','Prepare paper deployment of tested r1'],['start-bot','Start fixture paper runtime'],['close-chart','Close chart view'],['stop-bot','Stop runtime']],
    research: [['save-snapshot','Save research snapshot F1'],['source-fails','Illustrate source outage'],['retry','Refresh current fact to F2'],['resolve-listing','Verify fixture listing-to-chart mapping'],['open-chart','Open mapped original chart'],['return-research','Return to saved research']],
    unknown: [['reconcile','Reconcile: acknowledgement found'],['observe-fill','Observe confirmed fill'],['view-journal','Review confirmed account fills']],
    automation: [['validate','Validate scoped workflow'],['activate','Activate read-only fixture workflow'],['run','Receive trigger T1'],['deliver-trigger-again','Receive duplicate T1'],['add-order-action','Add unsupported order node']],
  }
  return map[s.kind].map(([id,label])=>({id,label,disabled:blockedReason(s,id)!==null,reason:blockedReason(s,id)}))
}

export function blockedReason(s,a) {
  if(s.kind==='import') {
    if(a==='commit'&&importCounts(s).invalid) return 'Correct required row errors before full commit'
    if(a==='open-journal'&&!s.receipt) return 'Commit a validated receipt first'
  }
  if(s.kind==='sync') {
    if(['refresh','limited-history'].includes(a)&&!s.engine) return 'Local engine is stopped; cached journal is still readable'
  }
  if(s.kind==='paper') {
    if(a==='pick-compatible'&&s.screen!=='SH01') return 'Open the dataset picker first'
    if(a==='start'&&!s.dataset) return 'Run P1 needs its exact compatible dataset'
    if(a==='start'&&s.step==='active') return 'P1 is already active'
    if(['paper-buy','paper-sell','advance'].includes(a)&&s.step!=='active') return 'Start the paper run first'
    if(['paper-buy','paper-sell'].includes(a)&&s.pending) return 'One fixture order is pending its next historical bar'
    if(a==='paper-buy'&&s.position!==0) return 'Fixture buy opens one position only'
    if(a==='paper-sell'&&s.position!==1) return 'A confirmed paper buy is required'
    if(a==='advance'&&s.clock>=2) return 'End of fixture data'
    if(a==='checkpoint'&&s.step!=='active') return 'Start the paper session before checkpointing'
    if(['paper-buy','paper-sell'].includes(a)&&s.clock>=2) return 'No next historical bar is available for this order'
    if(a==='finish'&&(s.position!==0||s.pending||!s.fills.length)) return 'Complete the paper position before finishing this fixture'
  }
  if(s.kind==='strategy') {
    if(a==='run'&&s.kindOfArtifact!=='Strategy') return 'An indicator alone has no trading P&L'
    if(a==='run'&&!s.dataset) return 'Pin a compatible dataset before testing'
    if(a==='run'&&s.draft!=='draft-1') return 'Validate a new revision before testing the edited draft; E1 retains r1'
    if(a==='prepare-paper'&&!s.experiments.length) return 'Save tested revision evidence first'
    if(a==='start-bot'&&!s.deployment) return 'Prepare an account-bound paper deployment first'
    if(a==='stop-bot'&&s.deployment?.state!=='running') return 'No running fixture deployment'
  }
  if(s.kind==='research') {
    if(a==='source-fails'&&!s.snapshot) return 'Save the evidence snapshot before this outage walkthrough'
    if(a==='retry'&&s.freshness!=='stale') return 'No failed refresh to retry in this walkthrough'
    if(a==='open-chart'&&!s.mapping) return 'No verified listing mapping; do not open a fallback ticker'
    if(a==='return-research'&&!s.snapshot) return 'Save the evidence snapshot first'
  }
  if(s.kind==='unknown') {
    if(a==='resubmit') return 'Unknown submission must be reconciled, never blindly resubmitted'
    if(a==='observe-fill'&&s.orderStatus==='unknown') return 'Reconcile account identity and operation first'
  }
  if(s.kind==='automation') {
    if(a==='activate'&&!s.validated) return 'Validate the current graph and capabilities first'
    if(a==='activate'&&s.nodes.includes('order')&&!s.capabilities.includes('execution')) return 'Read-only history access cannot grant execution permission'
    if(['run','deliver-trigger-again'].includes(a)&&!s.active) return 'Activate a validated supported workflow first'
  }
  return null
}

export function applyReviewAction(previous, action) {
  requireThat(previous.fixtureOnly===true,'Design fixtures only')
  const reason=blockedReason(previous,action);requireThat(reason===null,reason)
  requireThat(reviewActions(previous).some(a=>a.id===action)||['foreign-account','pick-wrong'].includes(action),'Unknown review action')
  const s=copy(previous);s.changed++;s.history.push(action)
  if(s.kind==='import') {
    if(action==='fix-row') {s.rows[2].quantity=1;s.notice='All required rows valid; existing event stays a duplicate, not a new trade.'}
    if(action==='commit') {
      if(!s.receipt) {let inserted=0,duplicates=0;for(const row of s.rows){if(row.externalId in s.records){duplicates++;continue}s.records[row.externalId]={netMinor:row.netMinor,review:''};inserted++}s.receipt={id:'import-1',bookId:s.scope.bookId,inserted,duplicates,invalid:0}}
      s.step='saved';s.notice='Same receipt and event identities retained on repeat commit.'
    }
    if(action==='open-journal') {s.screen='WS09';s.step='review';s.notice='Book A only. Existing user review is preserved.'}
  }
  if(s.kind==='sync') {
    if(action==='start-engine') {s.engine=true;if(!s.jobs.length)s.jobs.push({id:'sync-account-A',accountId:'account-A'});s.step='catch-up';s.notice='One account-scoped worker; opening another chart does not duplicate it.'}
    if(action==='refresh') {s.records['EXEC-100'].netMinor=800;if(!s.sourceObservations.includes('source-B:900'))s.sourceObservations.push('source-B:900');s.cursor='checkpoint-100';s.step='corrected';s.notice='Verified same-account/source identity: one execution, corrected fees, unchanged review.'}
    if(action==='limited-history') {s.coverage='partial-recent-window';s.notice='Request succeeded but older coverage is unknown. Offer statement/alternate-source backfill.'}
    if(action==='close-engine') {s.engine=false;s.step='paused';s.notice='Cached journal remains readable. No updates are claimed while the engine is stopped.'}
    if(action==='open-journal')s.screen='WS09'
    if(action==='foreign-account')fail('Cannot route account B observations into account A book')
  }
  if(s.kind==='paper') {
    if(action==='choose-data') {s.screen='SH01';s.notice='Keep return=P1 and BTCUSD-spot; another profile is unchanged.'}
    if(action==='pick-compatible') {s.dataset={id:'D1',instrumentId:'BTCUSD-spot',pricesMinor:[10000,10000,11000],engine:'fixture-v1'};s.screen='WS06';s.step='ready';s.notice='Exact compatible dataset chosen; return to the same run.'}
    if(action==='pick-wrong')fail('Dataset instrument mismatch; preserve run P1')
    if(action==='start') {s.screen='WS07';s.step='active'}
    if(action==='paper-buy'||action==='paper-sell')s.pending=action==='paper-buy'?'buy':'sell'
    if(action==='advance') {
      s.clock++
      if(s.pending) {const side=s.pending,price=s.dataset.pricesMinor[s.clock];s.cashMinor+=(side==='buy'?-price:price)-100;s.position+=side==='buy'?1:-1;s.fills.push({id:'P1-F'+s.clock,side,priceMinor:price,feeMinor:100,clock:s.clock});s.pending=null}
    }
    if(action==='checkpoint') {const snapshot=copy(s);snapshot.checkpoint=null;s.checkpoint=JSON.stringify(snapshot);s.notice='Fixture serialization illustrates the required durable checkpoint; production restore is P02/P06 work.'}
    if(action==='finish') {s.step='finished';s.screen='WS09';if(!s.journal.length)s.journal.push({id:'P1-T1',bookId:s.scope.bookId,netMinor:s.cashMinor-100000});s.notice='One simulated trade in paper book P1; no real-account journal or external order.'}
  }
  if(s.kind==='strategy') {
    if(action==='make-strategy'){s.kindOfArtifact='Strategy';s.step='rules';s.screen='SB04'}
    if(action==='choose-data'){s.dataset={id:'D1',instrumentId:'BTCUSD-spot',engine:'fixture-v1'};s.screen='SB05'}
    if(action==='run'){if(!s.experiments.length)s.experiments.push({id:'E1',revision:s.revision,parameters:copy(s.params),dataset:copy(s.dataset),netMinor:800,state:'completed'});s.screen='SB06';s.step='saved';s.notice='One fictional reproducible report; no measured trading performance.'}
    if(action==='edit-draft'){s.draft='draft-2';s.params.fast=12;s.notice='Draft changed; saved experiment E1 still pins r1 and fast=10.'}
    if(action==='prepare-paper'){const e=s.experiments[0];s.deployment={id:'DEP1',revision:e.revision,parameters:copy(e.parameters),accountId:'sim-P1',mode:'paper',state:'draft',openPositions:1};s.scope={...s.scope,deploymentId:'DEP1',accountId:'sim-P1',mode:'paper'};s.step='deployment-draft';s.screen='AUTO05'}
    if(action==='start-bot'){s.deployment.state='running';s.step='running';s.notice='Fixture paper runtime bound to DEP1; not a real bot process.'}
    if(action==='close-chart'){s.chartOpen=false;s.notice='Chart closed; deployment revision, account and runtime state unchanged.'}
    if(action==='stop-bot'){s.deployment.state='stopped';s.step='stopped';s.notice='Bot stopped; existing positions are not claimed closed or orders cancelled.'}
  }
  if(s.kind==='research') {
    if(action==='save-snapshot'){if(!s.snapshot)s.snapshot={id:'snapshot-F1',fact:copy(s.fact),note:s.note};s.screen='FND08';s.step='saved'}
    if(action==='source-fails'){s.freshness='stale';s.notice='Source unavailable. Keep source-backed snapshot and note; offer retry without execution setup.'}
    if(action==='retry'){s.fact={...s.fact,revision:'F2',value:'1250000'};s.freshness='current';s.notice='Current fact refreshed. Saved snapshot F1 still contains the original evidence.'}
    if(action==='resolve-listing')s.mapping={listingId:'AST-XTEST',instrumentId:'AST-XTEST-USD'}
    if(action==='open-chart'){s.screen='WS04';s.chart={instrumentId:s.mapping.instrumentId,returnTo:s.scope.returnTo};s.notice='Open exact mapped instrument with saved research return target.'}
    if(action==='return-research'){s.screen='FND08';s.step='saved';s.notice='Returned to the same issuer, snapshot and note.'}
  }
  if(s.kind==='unknown') {
    if(action==='reconcile'&&s.orderStatus!=='filled'){s.orderStatus='acknowledged';s.step='acknowledged';s.notice='Broker acknowledgement found. No confirmed fill or journal P&L yet.'}
    if(action==='observe-fill'){s.orderStatus='filled';s.step='filled';if(!s.fills.length)s.fills.push({id:'FILL1',accountId:s.scope.accountId,netMinor:900});s.notice='Confirmed fill; duplicate observations retain the same canonical fill ID.'}
    if(action==='view-journal'){s.screen='WS09';s.journal=s.fills.map(f=>({...f,bookId:s.scope.bookId}));s.notice='Only confirmed account fills are journaled; unknown/acknowledged intents are not trades.'}
  }
  if(s.kind==='automation') {
    if(action==='validate'){requireThat(!s.nodes.includes('order')||s.capabilities.includes('execution'),'Unsupported order capability');s.validated=true;s.notice='Exact graph/target capabilities validated for the fixture.'}
    if(action==='activate'){s.active=true;s.step='active';s.screen='AUTO03'}
    if(action==='run'||action==='deliver-trigger-again'){if(!s.runs.length)s.runs.push({id:'T1',accountId:s.scope.accountId,steps:['history-partial','notify']});s.screen='AUTO04';s.notice='Trigger T1 produces one account-scoped run; repeated delivery is the same operation.'}
    if(action==='add-order-action'){s.nodes.push('order');s.validated=false;s.active=false;s.notice='Graph changed; read-only rights do not authorize order actions.'}
  }
  return s
}

export function resumeReviewCheckpoint(serialized) {
  const s=JSON.parse(serialized)
  requireThat(s.fixtureOnly===true&&s.kind==='paper'&&s.scope?.runId==='P1'&&s.dataset?.id==='D1','Incompatible fixture checkpoint')
  return s
}
