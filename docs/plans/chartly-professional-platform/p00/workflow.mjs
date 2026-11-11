export function initialState() {
  return { screen:'S01', viewState:'ready', importValid:false, pricesValid:false,
    importCommitted:false, datasetReady:false, returnTo:null, reviewSaved:false,
    tradeClosed:false, runStarted:false, runFinished:false, checkpoint:false,
    bars:0, connectionFamily:null, connectionVerified:false, orderOutcome:'unknown',
    notebookSaved:false, reportSnapshot:false, researchPinned:false, reviewText:'', notebookText:'', message:'' };
}

export function transition(previous, action) {
  const next = {...previous, message:''};
  if (/^S(0[1-9]|1[0-9])$/.test(action)) {
    return {...next,screen:action,viewState:'ready'};
  }
  switch(action) {
    case 'VALIDATE_IMPORT': next.viewState=next.importValid?'saved':'partial'; next.message=next.importValid?'All 3 fixture rows are valid.':'2 valid rows; row 3 has an invalid timestamp. Correct mapping before commit.'; break;
    case 'FIX_IMPORT': next.importValid=true; next.viewState='saved'; next.message='Timestamp mapping corrected. All 3 fixture rows valid; none committed.'; break;
    case 'COMMIT_IMPORT':
      if(!next.importValid) {next.viewState='partial';next.message='Commit blocked: resolve row 3 timestamp; no rows written.';break;}
      next.message=next.importCommitted?'Fixture import already committed; no duplicate rows.':'3 fixture rows committed once. Open the journal to review.';
      next.importCommitted=true; next.viewState='saved';break;
    case 'SAVE_REVIEW': next.reviewSaved=true; next.viewState='saved'; next.message='Fixture review saved. No production record changed.';break;
    case 'CLOSE_TRADE': next.tradeClosed=true;next.viewState='saved';next.message='Fixture trade closed; review and record identity preserved.';break;
    case 'CHOOSE_RUN_DATA':next.screen='S05';next.returnTo='R1';next.viewState='empty';break;
    case 'VALIDATE_PRICES':next.pricesValid=true;next.viewState='saved';next.message='Fixture history validated; timezone, units and quality reviewed.';break;
    case 'COMMIT_DATASET':
      if(!next.pricesValid){next.viewState='partial';next.message='Validate the historical file before commit.';break;}
      next.datasetReady=true;next.screen='S05';next.viewState='saved';next.message='Immutable fixture dataset V1 selected. Return to run R1.';break;
    case 'SELECT_DATASET':next.datasetReady=true;next.viewState='saved';next.message='Fixture dataset V1 selected. Return to run R1.';break;
    case 'START_RUN':
      if(!next.datasetReady){next.viewState='partial';next.message='Run R1 needs a usable historical dataset. Choose run data and return here.';break;}
      next.runStarted=true;next.screen='S10';next.viewState='saved';next.message='Paper replay R1 ready; no broker target exists.';break;
    case 'RESUME_RUN':
      if(!next.checkpoint){next.screen='S09';next.viewState='partial';next.message='No checkpoint. Prepare run R1 first.';break;}
      next.screen='S10';next.viewState='saved';next.message='Fixture checkpoint resumed for R1.';break;
    case 'ADVANCE_RUN':
      if(!next.runStarted){next.viewState='failed';next.message='Prepare and start R1 before advancing.';break;}
      next.bars+=1;next.viewState='saved';next.message=`Fixture clock advanced ${next.bars} bar(s). No real matching engine runs.`;break;
    case 'SAVE_RUN':
      if(!next.runStarted){next.viewState='failed';next.message='No active run to save.';break;}
      next.checkpoint=true;next.viewState='saved';next.message='Fixture checkpoint recorded in memory; production persistence is P06.';break;
    case 'FINISH_RUN':
      if(!next.runStarted){next.viewState='failed';next.message='Cannot finish an unstarted run.';break;}
      next.runFinished=true;next.screen='S11';next.viewState='saved';next.message='Fixture run finished; simulated provenance retained.';break;
    case 'SETUP_CRYPTO':case 'SETUP_RETAIL':case 'SETUP_BROKER':
      next.connectionFamily=action.replace('SETUP_','').toLowerCase();next.screen='S13';next.viewState='empty';break;
    case 'VERIFY_CONNECTION':next.connectionVerified=true;next.viewState='saved';next.message='Read-only fixture identity verified. No real connection or execution permission granted.';break;
    case 'RECONCILE':next.orderOutcome='acknowledged';next.viewState='saved';next.message='Fixture reconciled: acknowledged, not filled. No duplicate command sent.';break;
    case 'RETRY_REPORT':next.viewState='failed';next.message='Fixture source remains unavailable. Open saved report snapshot or return to issuer.';break;
    case 'REPORT_SNAPSHOT':next.reportSnapshot=true;next.viewState='stale';next.message='Saved fixture report V1 opened; original source time retained.';break;
    case 'SAVE_NOTEBOOK':next.notebookSaved=true;next.viewState='saved';next.message='Fixture notebook saved with report V1 citation. No trading account required.';break;
    case 'PIN_RESEARCH':next.researchPinned=true;next.viewState='saved';next.message='Research pinned; no permissions changed.';break;
    case 'BACKUP_PREVIEW':next.viewState='saved';next.message='Fixture manifest: profiles, trades/reviews, chart views, dataset references and run checkpoints; credentials separate.';break;
    default: throw new Error(`Unsupported prototype action: ${action}`);
  }
  return next;
}
