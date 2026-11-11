import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spec} from './screen-spec.mjs';
import {initialState,transition} from './workflow.mjs';
const run=(...actions)=>actions.reduce(transition,initialState());

test('19 primary screens specify ready plus seven required states, focus and route',()=>{
 assert.equal(spec.screens.length,19);assert.equal(new Set(spec.screens.map(s=>s.id)).size,19);
 for(const s of spec.screens){assert.ok(s.route.startsWith('/'));assert.equal(Object.keys(s.states).length,8);assert.ok(s.states.ready);assert.ok(s.focus.failed);assert.ok(s.actions.length);}
});
test('every screen can be inspected without broker credentials',()=>{
 for(const s of spec.screens)assert.equal(transition(initialState(),s.id).screen,s.id);
 assert.equal(spec.fixtureOnly,true);
});
test('every declared action resolves to a valid prototype screen',()=>{
 for(const s of spec.screens)for(const [,action] of s.actions){
   const result=transition({...initialState(),screen:s.id},action);
   assert.ok(spec.screens.some(candidate=>candidate.id===result.screen),action);
 }
});
test('manual journal review and closure need no dataset or connection',()=>{
 const result=run('S02','S03','SAVE_REVIEW','CLOSE_TRADE');
 assert.equal(result.reviewSaved,true);assert.equal(result.tradeClosed,true);
 assert.equal(result.connectionVerified,false);assert.equal(result.datasetReady,false);
});
test('malformed statement cannot commit and retains correction path',()=>{
 const result=run('S04','VALIDATE_IMPORT','COMMIT_IMPORT');
 assert.equal(result.importCommitted,false);assert.equal(result.screen,'S04');assert.equal(result.viewState,'partial');
 assert.match(result.message,/row 3/);
});
test('corrected statement commits and duplicate commit is explicit',()=>{
 const result=run('S04','FIX_IMPORT','COMMIT_IMPORT','COMMIT_IMPORT');
 assert.equal(result.importCommitted,true);assert.match(result.message,/no duplicate/);
});
test('cancelling invalid import does not commit',()=>{
 const result=run('S04','VALIDATE_IMPORT','S02');assert.equal(result.importCommitted,false);
});
test('missing history prevents a run from starting',()=>{
 const result=run('S09','START_RUN');assert.equal(result.runStarted,false);assert.equal(result.screen,'S09');
 assert.match(result.message,/needs a usable historical dataset/);
});
test('source selection retains original R1 context and returns to preparation',()=>{
 const result=run('S09','CHOOSE_RUN_DATA','SELECT_DATASET','S09','START_RUN');
 assert.equal(result.returnTo,'R1');assert.equal(result.datasetReady,true);assert.equal(result.screen,'S10');
});
test('historical import must validate before immutable commit',()=>{
 const invalid=run('S06','COMMIT_DATASET');assert.equal(invalid.datasetReady,false);
 const valid=run('CHOOSE_RUN_DATA','S06','VALIDATE_PRICES','COMMIT_DATASET','S09','START_RUN');
 assert.equal(valid.datasetReady,true);assert.equal(valid.returnTo,'R1');assert.equal(valid.screen,'S10');
});
test('run advance save resume finish follows started run identity',()=>{
 const result=run('SELECT_DATASET','START_RUN','ADVANCE_RUN','SAVE_RUN','S08','RESUME_RUN','FINISH_RUN');
 assert.equal(result.bars,1);assert.equal(result.checkpoint,true);assert.equal(result.runFinished,true);assert.equal(result.screen,'S11');
});
test('unstarted run cannot advance save finish or pretend to resume',()=>{
 for(const action of ['ADVANCE_RUN','SAVE_RUN','FINISH_RUN'])assert.equal(run(action).viewState,'failed');
 assert.equal(run('RESUME_RUN').screen,'S09');assert.equal(run('RESUME_RUN').checkpoint,false);
});
test('unknown outcome offers reconciliation and never resubmission',()=>{
 const activity=spec.screens.find(s=>s.id==='S14');
 assert.equal(initialState().orderOutcome,'unknown');
 assert.ok(activity.actions.some(([,action])=>action==='RECONCILE'));
 assert.ok(!activity.actions.some(([label])=>/retry|submit|place/i.test(label)));
 const result=run('S14','RECONCILE');assert.equal(result.orderOutcome,'acknowledged');assert.notEqual(result.orderOutcome,'filled');
});
test('crypto retail and broker paths remain distinct read-only setup',()=>{
 for(const [action,family]of[['SETUP_CRYPTO','crypto'],['SETUP_RETAIL','retail'],['SETUP_BROKER','broker']]){
  const result=run(action,'VERIFY_CONNECTION');assert.equal(result.screen,'S13');assert.equal(result.connectionFamily,family);assert.equal(result.connectionVerified,true);
 }
});
test('unavailable report retains saved snapshot and research-only recovery',()=>{
 const failed=run('S15','S16','S17','RETRY_REPORT');assert.equal(failed.screen,'S17');assert.equal(failed.viewState,'failed');
 const saved=transition(failed,'REPORT_SNAPSHOT');assert.equal(saved.viewState,'stale');assert.equal(saved.reportSnapshot,true);
 const note=transition(transition(saved,'S18'),'SAVE_NOTEBOOK');assert.equal(note.notebookSaved,true);assert.equal(note.connectionVerified,false);
});
test('pinning a module does not grant connectivity or execution',()=>{
 const result=run('S19','PIN_RESEARCH');assert.equal(result.researchPinned,true);assert.equal(result.connectionVerified,false);assert.equal(result.orderOutcome,'unknown');
});
test('editor scope keeps journal and research drafts distinct',()=>{
 const journal={...initialState(),reviewText:'Journal lesson',notebookText:'Research hypothesis'};
 const result=transition(transition(journal,'S18'),'SAVE_NOTEBOOK');
 assert.equal(result.reviewText,'Journal lesson');assert.equal(result.notebookText,'Research hypothesis');
});
test('transitions do not mutate prior state',()=>{
 const original=initialState();transition(original,'FIX_IMPORT');assert.equal(original.importValid,false);
});
test('prototype has no network requests, credential field or live execution transport',()=>{
 const html=fs.readFileSync(new URL('./v1-harness.html',import.meta.url),'utf8');
 const model=fs.readFileSync(new URL('./workflow.mjs',import.meta.url),'utf8');
 for(const source of [html,model])assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|type=["']password/.test(source));
 assert.match(html,/Fictional fixtures only/);
});
test('HTML contract exposes labelled controls, status and focusable heading',()=>{
 const html=fs.readFileSync(new URL('./v1-harness.html',import.meta.url),'utf8');
 assert.match(html,/label for="screen-choice"/);assert.match(html,/label for="state-choice"/);
 assert.match(html,/aria-live="polite"/);assert.match(html,/id="screen-title" tabindex="-1"/);
});
