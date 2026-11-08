import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflightTerminal } from '../../../examples/windows-cli.mjs';
import { createAutomationState, warnPreviousState } from '../../../examples/cli/automation-state.mjs';
import { journalPath } from '../../../examples/cli/runtime.mjs';
import { connectClient, fiscalInput, runSession } from '../../../examples/windows-cli.mjs';

const configuration={server:'synthetic',storeId:'00000000',terminalId:'SR000001'};
async function fixture(fn) {
  const root=await mkdtemp(join(tmpdir(),'sitef-cli-state-'));
  try { await fn(root,join(root,'test.journal.json')); }
  finally { await rm(root,{recursive:true,force:true}); }
}
const record=state=>({version:2,id:'test-only',...configuration,
  functionId:0,fiscalDocument:'test',fiscalDate:'20261106',fiscalTime:'000000',
  state,updatedAt:'2026-11-06T00:00:00Z',payments:[{id:'test-only',functionId:0,
    entryPoint:'start',fiscalDocument:'test',fiscalDate:'20261106',fiscalTime:'000000',state,confirmationAllowed:false}]});
const io=()=>({writes:[],write(line){this.writes.push(line);},async ask(){return '3';}});

test('CLI history: missing state remains absent and no lock is created',async()=>{
  await fixture(async(root,file)=>{
    assert.deepEqual(await preflightTerminal(file),[]);
    assert.deepEqual(await warnPreviousState(root,configuration,io()),[]);
    assert.deepEqual(await readdir(root),[]);
  });
});
test('CLI history: locks including lock-shaped directories warn and are preserved',async()=>{
  await fixture(async(root,file)=>{
    await writeFile(file+'.lock','historical lock');
    assert.equal((await preflightTerminal(file))[0].code,'RECORD_LOCK_PRESENT');
    assert.equal(await readFile(file+'.lock','utf8'),'historical lock');
    await mkdir(join(root,'directory.journal.json.lock'));
    assert.equal((await preflightTerminal(join(root,'directory.journal.json')))[0].code,'RECORD_LOCK_PRESENT');
  });
});
test('CLI history: every unfinished state only warns without changing bytes',async()=>{
  await fixture(async(root,file)=>{
    for(const state of ['started','awaiting-finalization','finalizing','uncertain']){
      const bytes=JSON.stringify(record(state));await writeFile(file,bytes);
      assert.deepEqual(await preflightTerminal(file),[{code:'RECORD_PENDING',path:file}]);
      assert.equal(await readFile(file,'utf8'),bytes);assert.equal((await readdir(root)).length,1);
    }
    for(const state of ['ended','finalized-local']){
      const bytes=JSON.stringify(record(state));await writeFile(file,bytes);
      assert.deepEqual(await preflightTerminal(file),[]);assert.equal(await readFile(file,'utf8'),bytes);
    }
  });
});
test('CLI history: invalid records warn safely rather than blocking a new run',async()=>{
  await fixture(async(root)=>{
    const file=journalPath(root,configuration);await mkdir(join(root,'state'));
    await writeFile(file,'private-invalid-payload');
    const terminal=io();assert.equal((await warnPreviousState(root,configuration,terminal))[0].code,'RECORD_INVALID');
    assert.ok(!terminal.writes.join('').includes('private-invalid-payload'));
    const state=await createAutomationState(root);await state.onStateChange(record('started'));await state.close();
    assert.equal(await readFile(file,'utf8'),'private-invalid-payload');
  });
});
test('CLI automation: historical pending and lock do not stop start; close retains pending without finish',async()=>{
  await fixture(async(root)=>{
    const legacy=journalPath(root,configuration),old=join(root,'state','automation','older.journal.json');
    await mkdir(join(root,'state','automation'),{recursive:true});
    const bytes=JSON.stringify(record('uncertain'));
    for(const file of [legacy,old]){await writeFile(file,bytes);await writeFile(file+'.lock','historical lock');}
    const terminal=io(),warnings=await warnPreviousState(root,configuration,terminal);
    assert.equal(warnings.filter(x=>x.code==='RECORD_PENDING').length,2);
    assert.equal(warnings.filter(x=>x.code==='RECORD_LOCK_PRESENT').length,2);
    const state=await createAutomationState(root),calls=[];
    assert.match(state.path,/[\\/]state[\\/]automation[\\/][a-f0-9-]{36}\.journal\.json$/);
    const transport={async call(method){calls.push(method);
      if(method==='load')return{protocolVersion:1,platform:'windows',architecture:'x86_64',fieldTypeBytes:4};
      if(method==='configure'||method==='start')return{status:0};assert.fail(method);
    },async close(){calls.push('close');}};
    const client=await connectClient({transport,directory:root,configuration,io:terminal,onStateChange:state.onStateChange});
    await runSession({client,transport,input:fiscalInput('1,00',3),io:terminal});await state.close();
    assert.deepEqual(calls,['load','configure','start','close']);
    const saved=JSON.parse(await readFile(state.path,'utf8'));
    assert.equal(saved.state,'awaiting-finalization');assert.equal(saved.payments.length,1);
    assert.notEqual(saved.payments[0].id,'test-only');assert.equal(saved.payments[0].decision,undefined);
    for(const file of [legacy,old]){assert.equal(await readFile(file,'utf8'),bytes);assert.equal(await readFile(file+'.lock','utf8'),'historical lock');}
    await assert.rejects(access(state.path+'.lock'),{code:'ENOENT'});
    const second=await createAutomationState(root);assert.notEqual(second.path,state.path);await second.close();
    assert.equal(JSON.parse(await readFile(state.path,'utf8')).state,'awaiting-finalization');
  });
});
test('CLI automation: persistence failure propagates once and preserves prior bytes without retry',async()=>{
  await fixture(async(root)=>{
    const state=await createAutomationState(root);await state.onStateChange(record('started'));
    const bytes=await readFile(state.path,'utf8'),invalid=record('uncertain');
    invalid.payments[0].sensitiveFreeField='must-not-persist';
    let failure;await assert.rejects(state.onStateChange(invalid),error=>{failure=error;return error.code==='JOURNAL_INVALID';});
    await assert.rejects(state.onStateChange(record('ended')),error=>error===failure);
    assert.equal(await readFile(state.path,'utf8'),bytes);
    assert.deepEqual(state.snapshot,invalid);await state.close();
  });
});
test('CLI automation: concurrent callbacks/close cannot interleave a write or release its lease',async()=>{
  await fixture(async(root)=>{
    const state=await createAutomationState(root),write=state.onStateChange(record('started'));
    await assert.rejects(state.onStateChange(record('ended')),{code:'CLI_STATE_BUSY'});
    await assert.rejects(state.close(),{code:'CLI_STATE_BUSY'});
    await write;await state.close();assert.equal(JSON.parse(await readFile(state.path,'utf8')).state,'started');
    await assert.rejects(state.onStateChange(record('ended')),{code:'CLI_STATE_BUSY'});
  });
});
