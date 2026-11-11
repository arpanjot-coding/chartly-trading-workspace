import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createReviewSession as create, applyReviewAction as act, importCounts, blockedReason, canUseFactAsOf, parameterGrid, resumeReviewCheckpoint, scenarios, resolveConnectedBook, validateSourceBook } from './p00-review-model.mjs'

const here=dirname(fileURLToPath(import.meta.url))
const contracts=JSON.parse(readFileSync(resolve(here,'p00-screen-contracts.json'),'utf8'))
const screens=new Map(contracts.screens.map(s=>[s.id,s]))

test('P00 contains complete contracts for every current UI surface and preserves real references',()=>{
  assert.equal(screens.size,46)
  for(const s of screens.values()){
    for(const key of ['ready','empty','loading','saved','failed','stale','partial','unauthorized','unsupported','interrupted','dirty','offline'])assert.ok(s.states[key]?.length>20,`${s.id}/${key}`)
    for(const id of s.handoff)assert.ok(screens.has(id),`${s.id} → ${id}`)
    assert.ok(s.scope&&s.prerequisites&&s.frame.fields.length&&s.focus.failed&&s.narrow)
    if(s.frame.image)assert.ok(existsSync(resolve(here,'original-screen-review',s.frame.image)),s.frame.image)
  }
  assert.equal(contracts.productionFeatureAcceptance,false)
})

test('all design scenario entry screens exist and carry fictional fixture identity',()=>{
  for(const kind of scenarios){const s=create(kind.id);assert.equal(s.fixtureOnly,true);assert.ok(screens.has(s.screen))}
})

test('reconnecting an account reopens its one active connected book',()=>{
  assert.deepEqual(resolveConnectedBook([{id:'book-A',kind:'connected',accountId:'A'},{id:'old',kind:'connected',accountId:'A',archived:true}],'A'),{action:'open-existing',bookId:'book-A'})
  assert.deepEqual(resolveConnectedBook([],'B'),{action:'create-connected',accountId:'B'})
})

test('overlapping active books and unverified account identity require explicit resolution',()=>{
  assert.throws(()=>resolveConnectedBook([{id:'one',kind:'connected',accountId:'A'},{id:'two',kind:'connected',accountId:'A'}],'A'),/migration review/)
  assert.throws(()=>resolveConnectedBook([],null),/Verify a canonical account/)
})

test('manual/paper book bindings cannot be changed silently, and external sources must match',()=>{
  assert.throws(()=>validateSourceBook({kind:'manual'},'A'),/silently rebound/)
  assert.throws(()=>validateSourceBook({kind:'paper',accountId:'sim-P1'},'A'),/silently rebound/)
  assert.throws(()=>validateSourceBook({kind:'connected',accountId:'A'},'B'),/does not match/)
  assert.equal(validateSourceBook({kind:'connected',accountId:'A'},'A'),true)
})

test('a malformed quantity blocks full statement commit',()=>{
  const s=create('import');assert.deepEqual(importCounts(s),{invalid:1,duplicate:1,valid:1})
  assert.throws(()=>act(s,'commit'),/required row errors/)
  assert.equal(Object.keys(s.records).length,1)
})

test('correction, import and duplicate commit preserve the book and existing review',()=>{
  let s=act(create('import'),'fix-row');s=act(s,'commit')
  assert.deepEqual(s.receipt,{id:'import-1',bookId:'book-A',inserted:2,duplicates:1,invalid:0})
  s=act(s,'commit');assert.equal(Object.keys(s.records).length,3)
  assert.equal(s.records['EXIST-100'].review,'Keep my London-session review')
  s=act(s,'open-journal');assert.equal(s.screen,'WS09');assert.equal(s.scope.bookId,'book-A')
})

test('actions preserve the previous draft snapshot instead of mutating it',()=>{
  const s=create('import');act(s,'fix-row');assert.equal(s.rows[2].quantity,null);assert.equal(s.changed,0)
})

test('preview classifies same-file duplicates once and invalid rows take precedence',()=>{
  const s=create('import');s.rows.push({...s.rows[0]});s.rows.push({...s.rows[1],quantity:null})
  assert.deepEqual(importCounts(s),{invalid:2,duplicate:2,valid:1})
})

test('opening the engine twice starts one account-scoped sync job',()=>{
  let s=act(create('sync'),'start-engine');s=act(s,'start-engine')
  assert.deepEqual(s.jobs,[{id:'sync-account-A',accountId:'account-A'}])
})

test('verified overlapping sync corrects one canonical execution and keeps notes',()=>{
  let s=act(create('sync'),'start-engine');s=act(s,'refresh');s=act(s,'refresh')
  assert.equal(Object.keys(s.records).length,1);assert.equal(s.records['EXEC-100'].netMinor,800)
  assert.equal(s.records['EXEC-100'].review,'Keep my London-session review');assert.equal(s.sourceObservations.length,2)
})

test('a foreign account is never routed into the visible account book',()=>{
  assert.throws(()=>act(create('sync'),'foreign-account'),/account B.*account A/)
})

test('successful limited history retains partial coverage',()=>{
  let s=act(create('sync'),'start-engine');s=act(s,'limited-history')
  assert.equal(s.coverage,'partial-recent-window');assert.match(s.notice,/older coverage is unknown/)
})

test('engine shutdown leaves cached journal available and resume keeps the cursor',()=>{
  let s=act(create('sync'),'start-engine');s=act(s,'refresh');s=act(s,'close-engine')
  assert.throws(()=>act(s,'refresh'),/engine is stopped/)
  s=act(s,'open-journal');assert.equal(s.records['EXEC-100'].netMinor,800)
  s=act(s,'start-engine');assert.equal(s.cursor,'checkpoint-100');assert.equal(s.jobs.length,1)
})

test('paper Start requires data and setup returns to the original run/instrument',()=>{
  let s=create('paper');assert.throws(()=>act(s,'start'),/exact compatible dataset/)
  s=act(s,'choose-data');assert.equal(s.screen,'SH01')
  assert.throws(()=>act(s,'pick-wrong'),/instrument mismatch/)
  s=act(s,'pick-compatible');assert.equal(s.screen,'WS06');assert.equal(s.scope.runId,'P1')
  assert.equal(s.dataset.instrumentId,s.scope.instrumentId)
})

test('paper orders fill on the next bar, not a future price at submission',()=>{
  let s=act(act(act(create('paper'),'choose-data'),'pick-compatible'),'start')
  s=act(s,'paper-buy');assert.equal(s.fills.length,0);assert.equal(s.cashMinor,100000)
  s=act(s,'advance');assert.equal(s.fills[0].priceMinor,10000);assert.equal(s.cashMinor,89900)
  assert.equal(s.position,1);assert.equal(s.clock,1)
})

test('checkpoint/restore preserves paper ledger and completes one correctly costed trade',()=>{
  let s=act(act(act(create('paper'),'choose-data'),'pick-compatible'),'start')
  s=act(act(s,'paper-buy'),'advance');s=act(s,'checkpoint')
  s=resumeReviewCheckpoint(s.checkpoint);assert.equal(s.position,1);assert.equal(s.clock,1)
  s=act(act(s,'paper-sell'),'advance');assert.equal(s.cashMinor,100800)
  s=act(s,'finish');s=act(s,'finish');assert.equal(s.journal.length,1)
  assert.deepEqual(s.journal[0],{id:'P1-T1',bookId:'paper-book-P1',netMinor:800})
})

test('open paper positions and missing future bars block false completion/orders',()=>{
  let s=act(act(act(create('paper'),'choose-data'),'pick-compatible'),'start')
  s=act(act(s,'paper-buy'),'advance');assert.throws(()=>act(s,'finish'),/Complete the paper position/)
  s=act(act(s,'paper-sell'),'advance');assert.throws(()=>act(s,'paper-buy'),/No next historical bar/)
})

test('incompatible checkpoint cannot silently restore a different dataset',()=>{
  assert.throws(()=>resumeReviewCheckpoint(JSON.stringify({fixtureOnly:true,kind:'paper',scope:{runId:'P1'},dataset:{id:'wrong'}})),/Incompatible/)
})

test('an indicator cannot enter a P&L backtest; strategy still requires pinned data',()=>{
  let s=create('strategy');assert.throws(()=>act(s,'run'),/indicator alone/)
  s=act(s,'make-strategy');assert.throws(()=>act(s,'run'),/Pin a compatible dataset/)
})

test('saved experiment and deployment keep the tested parameters after draft edits',()=>{
  let s=act(act(act(create('strategy'),'make-strategy'),'choose-data'),'run')
  s=act(s,'edit-draft');assert.equal(s.params.fast,12);assert.equal(s.experiments[0].parameters.fast,10)
  assert.throws(()=>act(s,'run'),/Validate a new revision/)
  s=act(s,'prepare-paper');assert.equal(s.deployment.parameters.fast,10);assert.equal(s.deployment.revision,'r1')
  assert.equal(s.deployment.mode,'paper');assert.equal(s.deployment.accountId,'sim-P1')
  assert.equal(s.scope.accountId,'sim-P1');assert.equal(s.scope.deploymentId,'DEP1');assert.equal(s.step,'deployment-draft')
})

test('repeated baseline action does not invent extra experiments',()=>{
  let s=act(act(act(create('strategy'),'make-strategy'),'choose-data'),'run');s=act(s,'run')
  assert.equal(s.experiments.length,1);assert.equal(s.experiments[0].netMinor,800)
})

test('chart lifetime is separate from bot stop, and stop does not claim closed positions',()=>{
  let s=act(act(act(create('strategy'),'make-strategy'),'choose-data'),'run');s=act(s,'prepare-paper')
  s=act(s,'start-bot');s=act(s,'close-chart');assert.equal(s.deployment.state,'running')
  s=act(s,'stop-bot');assert.equal(s.deployment.state,'stopped');assert.equal(s.deployment.openPositions,1)
})

test('the declared parameter grid retains all considered candidates and rejections',()=>{
  const rows=parameterGrid();assert.equal(rows.length,9);assert.equal(rows.filter(r=>r.accepted).length,7)
  assert.deepEqual(rows.filter(r=>!r.accepted).map(({fast,slow})=>[fast,slow]),[[20,20],[30,20]])
})

test('source outage preserves immutable research evidence and note',()=>{
  let s=act(create('research'),'save-snapshot');s=act(s,'source-fails')
  assert.equal(s.freshness,'stale');assert.equal(s.snapshot.fact.revision,'F1');assert.ok(s.snapshot.note)
  s=act(s,'retry');assert.equal(s.fact.revision,'F2');assert.equal(s.snapshot.fact.revision,'F1')
  assert.equal(s.snapshot.fact.value,'1200000')
})

test('unmapped issuer does not open a default chart; mapped return retains evidence',()=>{
  let s=create('research');assert.throws(()=>act(s,'open-chart'),/No verified listing mapping/)
  s=act(act(s,'save-snapshot'),'resolve-listing');s=act(s,'open-chart')
  assert.equal(s.chart.instrumentId,'AST-XTEST-USD');assert.equal(s.chart.returnTo,'FND08/N1')
  s=act(s,'return-research');assert.equal(s.screen,'FND08');assert.equal(s.scope.issuerId,'issuer-AST')
})

test('research facts need known availability at the evaluation time',()=>{
  const fact=create('research').fact
  assert.equal(canUseFactAsOf(fact,'2026-02-01T00:00:00Z'),false)
  assert.equal(canUseFactAsOf(fact,'2026-04-01T00:00:00Z'),true)
  assert.equal(canUseFactAsOf({...fact,availableAt:null},'2026-04-01T00:00:00Z'),false)
})

test('unknown submission blocks resubmit and is not a journal fill',()=>{
  let s=create('unknown');assert.match(blockedReason(s,'resubmit'),/reconciled/)
  assert.throws(()=>act(s,'resubmit'),/reconciled/)
  s=act(s,'view-journal');assert.equal(s.journal.length,0)
})

test('acknowledgement remains distinct from confirmed fill and deduplicated journal entry',()=>{
  let s=act(create('unknown'),'reconcile');s=act(s,'view-journal');assert.equal(s.journal.length,0)
  s=act(s,'observe-fill');s=act(s,'observe-fill');s=act(s,'view-journal')
  assert.equal(s.journal.length,1);assert.equal(s.journal[0].bookId,'book-A');assert.equal(s.journal[0].accountId,'account-A')
  s=act(s,'reconcile');assert.equal(s.orderStatus,'filled')
})

test('read-only automation requires validation and deduplicates repeated triggers',()=>{
  let s=create('automation');assert.throws(()=>act(s,'activate'),/Validate/)
  s=act(act(s,'validate'),'activate');s=act(s,'run');s=act(s,'deliver-trigger-again')
  assert.equal(s.runs.length,1);assert.equal(s.runs[0].accountId,'account-A')
})

test('editing a workflow invalidates activation and read-only rights cannot send an order',()=>{
  let s=act(act(create('automation'),'validate'),'activate');s=act(s,'add-order-action')
  assert.equal(s.active,false);assert.equal(s.validated,false)
  assert.throws(()=>act(s,'validate'),/Unsupported order capability/)
  assert.throws(()=>act(s,'run'),/Activate a validated/)
})

test('undefined fixture actions and accidental production state are rejected',()=>{
  assert.throws(()=>act(create('import'),'anything'),/Unknown review action/)
  assert.throws(()=>act({...create('import'),fixtureOnly:false},'fix-row'),/Design fixtures only/)
})
