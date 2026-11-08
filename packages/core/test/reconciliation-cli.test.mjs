import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectJournal, inspectionReport, assertSnapshot, preserveEvidence,
  requireIdentity, recoveryScope, queryTransport, summarizeQuery, consultPending,
  terminalQueryTransport, summarizeTerminalQuery, consultTerminalPending } from '../../../examples/cli/reconciliation.mjs';
import { parseRecoveryArgs, recoveryJournalPath } from '../../../examples/windows-reconcile.mjs';
import { journalPath } from '../../../examples/cli/runtime.mjs';
import { createAutomationState } from '../../../examples/cli/automation-state.mjs';

const config = { server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001',reserved:0 };
const scope = { fiscalDocument:'3990911039',fiscalDate:'20261106' };
const record = () => ({
  version:2,id:'recovery-group',storeId:config.storeId,terminalId:config.terminalId,
  functionId:0,...scope,fiscalTime:'154831',state:'started',updatedAt:'2026-11-06T18:48:38.351Z',
  payments:[{id:'recovery-group',functionId:0,entryPoint:'start',...scope,fiscalTime:'154831',state:'started',confirmationAllowed:false}]
});
async function fixture(lock = false, value = record()) {
  const root = await mkdtemp(join(tmpdir(),'sitef-recovery-test-'));
  const state = join(root,'state'); await mkdir(state);
  const path = join(state,'test.journal.json');
  await writeFile(path,JSON.stringify(value));
  if(lock) await writeFile(path+'.lock',JSON.stringify({pid:123,createdAt:'2026-11-06T18:48:35Z'}));
  return {root,state,path,async clean(){await rm(root,{recursive:true,force:true});}};
}
const expected = snapshot => ({id:snapshot.record.id,hash:snapshot.hash});
async function withFixture(lock, fn, value) {
  const f = await fixture(lock,value);
  try { await fn(f,await inspectJournal(f.path,config)); } finally { await f.clean(); }
}
function native({count = 0, fields = [], finalStatus = 0, fail, closeFails = false} = {}) {
  const calls = [], queue = [...fields.map(([fieldType,buffer])=>({status:10000,command:0,fieldType,minLength:0,maxLength:0,buffer})),{status:finalStatus}];
  return {
    calls,
    async call(method,params) {
      calls.push({method,params});
      if(method===fail) throw Object.assign(new Error('private-native-buffer'),{code:'BRIDGE_TIMEOUT'});
      if(method==='load')return{protocolVersion:1,platform:'windows',architecture:'x86_64',fieldTypeBytes:4};
      if(method==='configure')return{status:0};
      if(method==='pendingCount')return{count,status:count};
      if(method==='start')return{status:10000};
      if(method==='continue')return queue.shift();
      assert.fail('Forbidden native call '+method);
    },
    async close(){if(closeFails)throw Object.assign(new Error('close'),{code:'BRIDGE_CLOSE_TIMEOUT'});}
  };
}
function options(f,snapshot,transport,overrides={}) {
  return {snapshot,expected:expected(snapshot),configuration:config,directory:f.root,
    evidenceDirectory:join(f.root,'evidence'),createTransport:()=>transport,...overrides};
}
test('recovery: inspection is read-only even with orphan lock; reports no invented cancellation',async()=>{
  await withFixture(true,async(f,s)=>{
    const before = await readdir(f.state);
    const report=inspectionReport(s);
    assert.equal(report.lockPresent,true); assert.equal(report.state,'started');
    assert.equal(report.nativeCalls,0); assert.equal(report.financialDecision,'none');
    assert.equal(report.lockOwner.pid,123); assert.equal(report.nextStep,'LOCK_REVIEW_REQUIRED');
    await assertSnapshot(s);
    assert.deepEqual(await readdir(f.state),before);
  });
});
test('recovery: only safe metadata printed, not arbitrary provider payloads',async()=>{
  const r=record();r.payments[0].finalizationParameters='do-not-log-secret';
  await withFixture(false,async(f,s)=>{
    assert.ok(!JSON.stringify(inspectionReport(s)).includes('do-not-log-secret'));
    assert.throws(()=>recoveryScope(s),{code:'RECOVERY_PLAN_REVIEW_REQUIRED'});
  },r);
});
test('recovery: evidence copies exact bytes and hashes without editing originals',async()=>{
  await withFixture(true,async(f,s)=>{
    const d=join(f.root,'evidence');
    const m=await preserveEvidence(s,d,expected(s));
    assert.equal(m.complete,true); assert.equal(m.journalSha256,s.hash);
    assert.deepEqual(await readFile(join(d,'journal.json')),s.bytes);
    assert.deepEqual(await readFile(join(d,'journal.lock')),s.lock);
    await assertSnapshot(s);
    await assert.rejects(preserveEvidence(s,d,expected(s)),{code:'EEXIST'});
  });
});
test('recovery: expected identity and changed journal/lock fail closed before evidence write',async()=>{
  await withFixture(true,async(f,s)=>{
    assert.throws(()=>requireIdentity(s,{id:'wrong',hash:s.hash}),{code:'RECOVERY_IDENTITY_MISMATCH'});
    assert.throws(()=>requireIdentity(s,{id:s.record.id,hash:'0'.repeat(64)}),{code:'RECOVERY_IDENTITY_MISMATCH'});
    await writeFile(f.path+'.lock','new owner');
    await assert.rejects(preserveEvidence(s,join(f.root,'evidence'),expected(s)),{code:'RECOVERY_CHANGED'});
    await assert.rejects(access(join(f.root,'evidence')),{code:'ENOENT'});
  });
});
test('recovery: existing lock prevents native creation and evidence write',async()=>{
  await withFixture(true,async(f,s)=>{
    await assert.rejects(consultPending(options(f,s,null,{createTransport(){assert.fail('native spawn');}})),{code:'RECOVERY_LOCK_PRESENT'});
    await assertSnapshot(s);
    await assert.rejects(access(join(f.root,'evidence')),{code:'ENOENT'});
  });
});
test('recovery: hash mismatch or source change prevents native spawn',async()=>{
  await withFixture(false,async(f,s)=>{
    const args=options(f,s,null,{createTransport(){assert.fail('native spawn');}});
    await assert.rejects(consultPending({...args,expected:{id:s.record.id,hash:'0'.repeat(64)}}),{code:'RECOVERY_IDENTITY_MISMATCH'});
    await writeFile(f.path,s.bytes+' ');
    await assert.rejects(consultPending(args),{code:'RECOVERY_CHANGED'});
    await assert.rejects(access(f.path+'.lock'),{code:'ENOENT'});
  });
});
test('recovery: no native call when already aborted',async()=>{
  await withFixture(false,async(f,s)=>{
    const signal=AbortSignal.abort();
    await assert.rejects(consultPending(options(f,s,null,{signal,createTransport(){assert.fail('native spawn');}})),{code:'RECOVERY_ABORTED'});
    await assertSnapshot(s);
  });
});
test('recovery: narrow adapter refuses sales, finish, flush, other documents and retries',async()=>{
  const raw={async call(){return{status:0};},async close(){}};
  const t=queryTransport(raw,config,scope);
  for(const method of ['finish','load','flushMessages','pinpadPresent','readSecureCard'])
    await assert.rejects(t.call(method,{}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('configure',{...config,additionalParameters:''});
  await assert.rejects(t.call('configure',{...config,additionalParameters:''}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await assert.rejects(t.call('pendingCount',{...scope,fiscalDocument:'different'}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('pendingCount',scope);
  const input={...scope,functionId:131,amount:'',fiscalTime:'000000',operator:'',additionalParameters:''};
  await assert.rejects(t.call('start',{...input,functionId:0}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('start',input);
  await assert.rejects(t.call('start',input),{code:'RECOVERY_NATIVE_FORBIDDEN'});
});
test('recovery: actual SDK queries 131 only, preserves started journal, retains its own lock even on completed query',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({fields:[[210,'0']]});
    const output=await consultPending(options(f,s,t));
    assert.equal(output.outcome,'no-local-pending-found');
    assert.equal(output.journalDisposition,'preserved');
    assert.deepEqual(t.calls.filter(c=>c.method==='start').map(c=>c.params.functionId),[131]);
    assert.equal(t.calls.filter(c=>c.method==='finish').length,0);
    await assertSnapshot(s,false);
    assert.equal(output.lockDisposition,'preserved-for-review');
    assert.equal(JSON.parse(await readFile(f.path+'.lock','utf8')).purpose,'read-only-recovery-query');
    assert.equal(JSON.parse(await readFile(f.path,'utf8')).state,'started');
  });
});
test('recovery: missing document stays distinct from canceled or successful recovery',async()=>{
  await withFixture(false,async(f,s)=>{
    const output=await consultPending(options(f,s,native({count:-13,fields:[[210,'0']]})));
    assert.equal(output.outcome,'document-not-found'); assert.equal(output.financialDecision,'none');
    await assertSnapshot(s,false);
  });
});
test('recovery: positive query only reports and never finalizes',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({count:1,fields:[[210,'1'],[160,scope.fiscalDocument],[161,'0'],[163,scope.fiscalDate],[164,'154831'],[211,'3'],[1319,'1,00']]});
    const result=await consultPending(options(f,s,t));
    assert.equal(result.outcome,'pending-review-required'); assert.equal(result.payments.length,1);
    assert.ok(!JSON.stringify(result).includes('fields'));
    assert.ok(!t.calls.some(c=>c.method==='finish')); await assertSnapshot(s,false);
  });
});
test('recovery: native timeout retains query lock and original journal; no replay',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({fail:'pendingCount'});
    await assert.rejects(consultPending(options(f,s,t)),{code:'BRIDGE_TIMEOUT'});
    assert.equal(t.calls.filter(c=>c.method==='pendingCount').length,1);
    assert.ok(!t.calls.some(c=>c.method==='start'||c.method==='finish'));
    assert.deepEqual(await readFile(f.path),s.bytes); await access(f.path+'.lock');
  });
});
test('recovery: incomplete query and close failure retain lock rather than claim recovery',async()=>{
  for(const args of [{finalStatus:-40},{closeFails:true}])
    await withFixture(false,async(f,s)=>{
      await assert.rejects(consultPending(options(f,s,native(args))));
      assert.deepEqual(await readFile(f.path),s.bytes); await access(f.path+'.lock');
    });
});
test('recovery: conflicting native count and foreign fiscal scope rejected',()=>{
  const valid={fiscalDocument:scope.fiscalDocument,fiscalDate:scope.fiscalDate,paymentIndex:'0'};
  assert.throws(()=>summarizeQuery(0,{status:0,count:1,transactions:[valid]},scope),{code:'RECOVERY_COUNT_MISMATCH'});
  assert.throws(()=>summarizeQuery(1,{status:0,transactions:[{...valid,fiscalDate:'20261107'}]},scope),{code:'RECOVERY_SCOPE_MISMATCH'});
  assert.throws(()=>summarizeQuery(2,{status:0,transactions:[valid,valid]},scope),{code:'RECOVERY_SCOPE_MISMATCH'});
  assert.equal(summarizeQuery(2,{status:0,transactions:[valid,{...valid,paymentIndex:'1'}]},scope).outcome,'additional-payments-review-required');
});
test('recovery: multiple pending payments and legacy journals require manual scope review',async()=>{
  const r=record();r.payments.push({...r.payments[0],id:'sibling'});
  await withFixture(false,async(f,s)=>assert.throws(()=>recoveryScope(s),{code:'RECOVERY_SCOPE_UNSUPPORTED'}),r);
  const legacy={...record(),version:1};delete legacy.payments;
  await withFixture(false,async(f,s)=>assert.throws(()=>recoveryScope(s),{code:'RECOVERY_SCOPE_UNSUPPORTED'}),legacy);
});
test('recovery: CLI defaults read-only, rejects finalization, stale lock removal and ambiguous arguments',()=>{
  assert.equal(parseRecoveryArgs([]).mode,'inspect');
  for(const args of [['--finalizar'],['--desfazer'],['--limpar-lock'],['--consultar'],['--consultar','--inspecionar'],['--grupo','one','--grupo','two']])
    assert.throws(()=>parseRecoveryArgs(args),{code:'RECOVERY_ARGUMENTS'});
  const args=['--consultar','--grupo','id','--hash','a'.repeat(64),'--evidencias','destination'];
  assert.equal(parseRecoveryArgs(args).mode,'query');
});

test('recovery: two queries racing for one journal start at most one native process',async()=>{
  await withFixture(false,async(f,s)=>{
    let created=0;
    const make=()=>{created++;return native({fields:[[210,'0']]});};
    const results=await Promise.allSettled([
      consultPending(options(f,s,null,{createTransport:make,evidenceDirectory:join(f.root,'evidence-a')})),
      consultPending(options(f,s,null,{createTransport:make,evidenceDirectory:join(f.root,'evidence-b')}))
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(created,1);
    await assertSnapshot(s,false);
  });
});
test('recovery: native changing journal during query is detected and lock preserved',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native();
    const call=t.call.bind(t);
    t.call=async(method,params)=>{
      if(method==='pendingCount') await writeFile(f.path,s.bytes+' ');
      return call(method,params);
    };
    await assert.rejects(consultPending(options(f,s,t)),{code:'RECOVERY_CHANGED'});
    await access(f.path+'.lock');
  });
});
test('recovery: creating a replacement lock during query never causes its removal',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native();
    const call=t.call.bind(t);
    t.call=async(method,params)=>{
      if(method==='pendingCount') await writeFile(f.path+'.lock','replacement-lock');
      return call(method,params);
    };
    await assert.rejects(consultPending(options(f,s,t)),{code:'RECOVERY_LOCK_CHANGED'});
    assert.equal(await readFile(f.path+'.lock','utf8'),'replacement-lock');
  });
});

test('recovery: parser validates the exact bytes bound to SHA-256, not a separate file read',async()=>{
  await withFixture(false,async(f,s)=>{
    const fromBytes=JSON.parse(s.bytes.toString('utf8'));
    assert.equal(s.record.id,fromBytes.id);
    assert.equal(s.record.payments[0].fiscalDocument,fromBytes.payments[0].fiscalDocument);
    // Replacing disk content after inspection cannot change the bound snapshot.
    const changed=record();changed.id='other';changed.payments[0].fiscalDocument='other';
    await writeFile(f.path,JSON.stringify(changed));
    assert.equal(recoveryScope(s).fiscalDocument,scope.fiscalDocument);
    await assert.rejects(consultPending(options(f,s,null,{createTransport(){assert.fail('spawn');}})),{code:'RECOVERY_CHANGED'});
  });
});

test('recovery: inconclusive query persists safe native codes before exit without buffers',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({count:-13,finalStatus:-40});
    await assert.rejects(consultPending(options(f,s,t)),error=>{
      assert.equal(error.code,'RECOVERY_QUERY_INCONCLUSIVE');
      assert.equal(error.recoveryReport.pendingCount,-13);
      assert.equal(error.recoveryReport.queryStatus,-40);
      assert.equal(error.recoveryReport.reportPersisted,true);
      return true;
    });
    const report=JSON.parse(await readFile(join(f.root,'evidence','query-result.json'),'utf8'));
    assert.equal(report.phase,'query131');
    assert.equal(report.queryStatus,-40);
    assert.equal(report.financialDecision,'none');
    assert.equal(report.lockDisposition,'preserved-for-review');
    assert.ok(!JSON.stringify(report).includes('private-native-buffer'));
    assert.deepEqual(await readFile(f.path),s.bytes);
  });
});


const terminalStart = {
  functionId:130,amount:'',fiscalDocument:'',fiscalDate:'',fiscalTime:'',operator:'',additionalParameters:''
};
const terminalPayment = (overrides = {}) => ({
  ...scope,paymentIndex:'0',functionId:3,...overrides
});
const terminalResult = (transactions = [], count = transactions.length) => ({
  status:0,count,transactions,fields:[{command:0,fieldType:210,buffer:String(count)}]
});
test('recovery terminal: CLI requires explicit identity/evidence and rejects combined modes',()=>{
  const args=['--consultar-terminal','--grupo','id','--hash','a'.repeat(64),'--evidencias','destination'];
  assert.equal(parseRecoveryArgs(args).mode,'terminal-query');
  for(const values of [['--consultar-terminal'],[...args,'--consultar'],[...args,'--inspecionar']])
    assert.throws(()=>parseRecoveryArgs(values),{code:'RECOVERY_ARGUMENTS'});
});
test('recovery terminal: separate adapter authorizes only exact configuration, one 130 and active continuations',async()=>{
  const calls=[];
  const raw={async call(method,params){calls.push({method,params});return{status:method==='start'?10000:0};},async close(){}};
  const t=terminalQueryTransport(raw,config);
  await assert.rejects(t.call('start',terminalStart),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await assert.rejects(t.call('continue',{buffer:'',continueFlag:0,bufferSize:20000}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await assert.rejects(t.call('configure',{...config,terminalId:'OTHER001',additionalParameters:''}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('configure',{...config,additionalParameters:''});
  await assert.rejects(t.call('configure',{...config,additionalParameters:''}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  for(const method of ['pendingCount','finish','flushMessages','readSecureCard','readChip','readTrack3','load','pinpadPresent'])
    await assert.rejects(t.call(method,scope),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  for(const params of [{...terminalStart,functionId:131},{...terminalStart,functionId:0},
    {...terminalStart,amount:'1,00'},{...terminalStart,...scope},
    {...terminalStart,fiscalTime:'000000'},{...terminalStart,additionalParameters:'extra'}])
    await assert.rejects(t.call('start',params),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('start',terminalStart);
  await assert.rejects(t.call('start',terminalStart),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  for(const params of [{buffer:'',continueFlag:1,bufferSize:20000},
    {buffer:'',continueFlag:0,bufferSize:19999},{buffer:'',continueFlag:0,bufferSize:20000,other:1}])
    await assert.rejects(t.call('continue',params),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  await t.call('continue',{buffer:'',continueFlag:-1,bufferSize:20000});
  await assert.rejects(t.call('continue',{buffer:'',continueFlag:0,bufferSize:20000}),{code:'RECOVERY_NATIVE_FORBIDDEN'});
  assert.deepEqual(calls.map(c=>c.method),['configure','start','continue']);
});
test('recovery terminal: success without explicit field 210 fails and persists safe diagnostics',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native();
    await assert.rejects(consultTerminalPending(options(f,s,t)),error=>{
      assert.equal(error.code,'RECOVERY_COUNT_MISSING');
      assert.equal(error.recoveryReport.phase,'query130');
      assert.equal(error.recoveryReport.queryStatus,0);
      assert.equal(error.recoveryReport.journalDisposition,'preserved');
      assert.notEqual(error.recoveryReport.outcome,'no-local-pending-found');
      return true;
    });
    assert.deepEqual(await readFile(f.path),s.bytes);
    await access(f.path+'.lock');
  });
});
test('recovery terminal: explicit zero uses actual SDK 130 without pendingCount and retains journal/lock',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({fields:[[210,'0']]});
    const result=await consultTerminalPending(options(f,s,t));
    assert.equal(result.outcome,'no-local-pending-found');
    assert.equal(result.pendingCount,0);assert.equal(result.listedCount,0);
    assert.deepEqual(t.calls.find(c=>c.method==='start').params,terminalStart);
    assert.ok(t.calls.every(c=>['load','configure','start','continue'].includes(c.method)));
    assert.equal(t.calls.filter(c=>c.method==='start').length,1);
    assert.equal(result.financialDecision,'none');
    assert.equal(result.lockDisposition,'preserved-for-review');
    assert.equal(JSON.parse(await readFile(f.path+'.lock','utf8')).purpose,'read-only-recovery-query');
    assert.deepEqual(await readFile(f.path),s.bytes);
  });
});
test('recovery terminal: complete identities across fiscal documents are allowed; only allowlisted metadata persists',async()=>{
  await withFixture(false,async(f,s)=>{
    const t=native({fields:[[210,'2'],[160,scope.fiscalDocument],[161,'0'],[163,scope.fiscalDate],
      [164,'154831'],[211,'3'],[1319,'1234,56'],[999999,'private-free-field'],
      [160,'other-document'],[161,'0'],[163,'20261105'],[211,'2'],[1319,'9876,54']]});
    const result=await consultTerminalPending(options(f,s,t));
    assert.equal(result.outcome,'pending-review-required');
    assert.deepEqual(result.payments,[terminalPayment(),terminalPayment({fiscalDocument:'other-document',fiscalDate:'20261105',functionId:2})]);
    const report=await readFile(join(f.root,'evidence','query-result.json'),'utf8');
    for(const secret of ['1234,56','9876,54','private-free-field','"fields"','"amount"','"fiscalTime"'])
      assert.ok(!report.includes(secret));
    assert.deepEqual(await readFile(f.path),s.bytes);
    await access(f.path+'.lock');
  });
});
test('recovery terminal: missing, repeated or inconsistent count and incomplete/duplicate identities fail closed',()=>{
  assert.throws(()=>summarizeTerminalQuery({...terminalResult(),fields:[]}),{code:'RECOVERY_COUNT_MISSING'});
  assert.throws(()=>summarizeTerminalQuery({...terminalResult(),count:undefined}),{code:'RECOVERY_COUNT_MISMATCH'});
  assert.throws(()=>summarizeTerminalQuery({...terminalResult(),fields:[{command:0,fieldType:210,buffer:'0'},{command:0,fieldType:210,buffer:'0'}]}),{code:'RECOVERY_COUNT_MISMATCH'});
  assert.throws(()=>summarizeTerminalQuery(terminalResult([],1)),{code:'RECOVERY_COUNT_MISMATCH'});
  assert.throws(()=>summarizeTerminalQuery(terminalResult([terminalPayment(),terminalPayment()])),{code:'RECOVERY_SCOPE_MISMATCH'});
  for(const overrides of [{fiscalDocument:''},{fiscalDocument:'control\ntext'},
    {fiscalDate:'invalid'},{paymentIndex:''},{functionId:NaN},{functionId:-1}])
    assert.throws(()=>summarizeTerminalQuery(terminalResult([terminalPayment(overrides)])),{code:'RECOVERY_SCOPE_MISMATCH'});
});
test('recovery terminal: actual SDK rejects inconsistent counts, duplicate records and missing identifiers without writes',async()=>{
  for(const fields of [[[210,'1']],
    [[210,'2'],[160,scope.fiscalDocument],[161,'0'],[163,scope.fiscalDate],
      [160,scope.fiscalDocument],[161,'0'],[163,scope.fiscalDate]],
    [[210,'1'],[160,scope.fiscalDocument],[163,scope.fiscalDate]]])
    await withFixture(false,async(f,s)=>{
      const t=native({fields});
      await assert.rejects(consultTerminalPending(options(f,s,t)));
      assert.deepEqual(await readFile(f.path),s.bytes);
      await access(f.path+'.lock');
      assert.ok(!t.calls.some(c=>['finish','flushMessages','pendingCount'].includes(c.method)));
    });
});
test('recovery terminal: native -13 remains inconclusive, never no pending or canceled',async()=>{
  await withFixture(false,async(f,s)=>{
    await assert.rejects(consultTerminalPending(options(f,s,native({finalStatus:-13}))),error=>{
      assert.equal(error.code,'RECOVERY_QUERY_INCONCLUSIVE');
      assert.equal(error.recoveryReport.queryStatus,-13);
      assert.equal(error.recoveryReport.outcome,'query-inconclusive');
      assert.equal(error.recoveryReport.financialDecision,'none');
      return true;
    });
    assert.deepEqual(await readFile(f.path),s.bytes);await access(f.path+'.lock');
  });
});
test('recovery terminal: lock, identity mismatch and early abort prevent native construction',async()=>{
  await withFixture(true,async(f,s)=>{
    await assert.rejects(consultTerminalPending(options(f,s,null,{createTransport(){assert.fail('native spawn');}})),{code:'RECOVERY_LOCK_PRESENT'});
    await assertSnapshot(s);await assert.rejects(access(join(f.root,'evidence')),{code:'ENOENT'});
  });
  await withFixture(false,async(f,s)=>{
    const args=options(f,s,null,{createTransport(){assert.fail('native spawn');}});
    await assert.rejects(consultTerminalPending({...args,expected:{id:'wrong',hash:s.hash}}),{code:'RECOVERY_IDENTITY_MISMATCH'});
    await assert.rejects(consultTerminalPending({...args,signal:AbortSignal.abort()}),{code:'RECOVERY_ABORTED'});
    await assertSnapshot(s);await assert.rejects(access(f.path+'.lock'),{code:'ENOENT'});
  });
});
test('recovery terminal: timeouts and close failure preserve state and lock without replay',async()=>{
  for(const args of [{fail:'start'},{fail:'continue'},{fields:[[210,'0']],closeFails:true}])
    await withFixture(false,async(f,s)=>{
      const t=native(args);
      await assert.rejects(consultTerminalPending(options(f,s,t)));
      assert.equal(t.calls.filter(c=>c.method==='start').length,1);
      assert.deepEqual(await readFile(f.path),s.bytes);await access(f.path+'.lock');
      const report=await readFile(join(f.root,'evidence','query-result.json'),'utf8');
      assert.ok(!report.includes('private-native-buffer'));
      assert.ok(!t.calls.some(c=>['finish','flushMessages','pendingCount'].includes(c.method)));
    });
});
test('recovery terminal: mid-query cancellation drains -1 without finalization and preserves evidence',async()=>{
  await withFixture(false,async(f,s)=>{
    const controller=new AbortController(),t=native({fields:[[210,'0']]});
    const call=t.call.bind(t);
    t.call=async(method,params)=>{
      const value=await call(method,params);
      if(method==='start') controller.abort();
      if(method==='continue'&&params.continueFlag===-1)return{status:-2};
      return value;
    };
    await assert.rejects(consultTerminalPending(options(f,s,t,{signal:controller.signal})));
    assert.ok(t.calls.some(c=>c.method==='continue'&&c.params.continueFlag===-1));
    assert.equal(t.calls.filter(c=>c.method==='start').length,1);
    assert.ok(!t.calls.some(c=>['finish','flushMessages','pendingCount'].includes(c.method)));
    assert.deepEqual(await readFile(f.path),s.bytes);await access(f.path+'.lock');
  });
});
test('recovery terminal: competing query, journal change and replacement lock retain existing protections',async()=>{
  await withFixture(false,async(f,s)=>{
    let created=0;
    const make=()=>{created++;return native({fields:[[210,'0']]});};
    const results=await Promise.allSettled([
      consultTerminalPending(options(f,s,null,{createTransport:make,evidenceDirectory:join(f.root,'evidence-a')})),
      consultPending(options(f,s,null,{createTransport:make,evidenceDirectory:join(f.root,'evidence-b')}))
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(created,1);
    await assertSnapshot(s,false);await access(f.path+'.lock');
  });
  for(const replacement of ['journal','lock'])
    await withFixture(false,async(f,s)=>{
      const t=native({fields:[[210,'0']]}),call=t.call.bind(t);
      t.call=async(method,params)=>{
        if(method==='start')await writeFile(replacement==='journal'?f.path:f.path+'.lock',replacement==='journal'?s.bytes+' ':'replacement-lock');
        return call(method,params);
      };
      await assert.rejects(consultTerminalPending(options(f,s,t)),{code:replacement==='journal'?'RECOVERY_CHANGED':'RECOVERY_LOCK_CHANGED'});
      await access(f.path+'.lock');
      if(replacement==='lock')assert.equal(await readFile(f.path+'.lock','utf8'),'replacement-lock');
    });
});

test('recovery: runtime selection stays separate from root and required evidence identity',()=>{
  assert.deepEqual(parseRecoveryArgs(['--inspecionar','--diretorio','ROOT','--runtime','DLL']),{mode:'inspect',root:'ROOT',runtime:'DLL'});
  assert.throws(()=>parseRecoveryArgs(['--consultar','--runtime','DLL']),{code:'RECOVERY_ARGUMENTS'});
  assert.throws(()=>parseRecoveryArgs(['--runtime']),{code:'RECOVERY_ARGUMENTS'});
});

test('recovery: explicit automation record never guesses a run or replaces the legacy default',async()=>{
  await withFixture(false,async(f,s)=>{
    const selected=join(f.root,'state','automation','chosen.journal.json');
    await mkdir(join(f.root,'state','automation'));
    await writeFile(selected,s.bytes);
    const args=parseRecoveryArgs(['--registro',selected,'--inspecionar']);
    assert.equal(args.recordPath,selected);
    assert.equal(recoveryJournalPath(f.root,config,args.recordPath),selected);
    assert.equal(recoveryJournalPath(f.root,config),journalPath(f.root,config));
    const selectedSnapshot=await inspectJournal(selected,config);
    assert.equal(selectedSnapshot.hash,s.hash);
    assert.throws(()=>parseRecoveryArgs(['--registro','relative']),{code:'RECOVERY_ARGUMENTS'});
    assert.throws(()=>parseRecoveryArgs(['--registro',selected,'--consultar']),{code:'RECOVERY_ARGUMENTS'});
    assert.throws(()=>parseRecoveryArgs(['--registro',selected,'--registro',selected]),{code:'RECOVERY_ARGUMENTS'});
    assert.throws(()=>requireIdentity(selectedSnapshot,{id:'other',hash:s.hash}),{code:'RECOVERY_IDENTITY_MISMATCH'});
    assert.deepEqual(await readFile(f.path),s.bytes);
    assert.deepEqual(await readFile(selected),s.bytes);
  });
});

test('recovery: newly persisted awaiting-finalization record supports explicit read-only query and evidence',async()=>{
  await withFixture(false,async(f,legacy)=>{
    const writer=await createAutomationState(f.root),pending=record();
    pending.state='awaiting-finalization';pending.payments[0].state='awaiting-finalization';
    await writer.onStateChange(pending);await writer.close();
    const args=parseRecoveryArgs(['--registro',writer.path]);
    const snapshot=await inspectJournal(recoveryJournalPath(f.root,config,args.recordPath),config);
    const transport=native({fields:[[210,'0']]});
    const result=await consultPending(options(f,snapshot,transport));
    assert.equal(result.financialDecision,'none');assert.equal(result.lockDisposition,'preserved-for-review');
    assert.deepEqual(await readFile(snapshot.path),snapshot.bytes);await access(snapshot.path+'.lock');
    assert.deepEqual(await readFile(f.path),legacy.bytes);await assert.rejects(access(f.path+'.lock'),{code:'ENOENT'});
    assert.ok(!transport.calls.some(call=>['finish','flushMessages'].includes(call.method)));
  });
});
