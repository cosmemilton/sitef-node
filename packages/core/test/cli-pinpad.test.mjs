import test from 'node:test';
import assert from 'node:assert/strict';
import { SitefClient } from '../dist/index.js';
import { createPinpadResources } from '../../../examples/cli/pinpad.mjs';
import { createInteraction } from '../../../examples/cli/interaction.mjs';
import { fiscalInput, runSimulation } from '../../../examples/windows-cli.mjs';

function fixture(steps = []) {
  const calls = [], writes = [];
  let record, releases = 0;
  const io = { write: line => writes.push(line), ask: async () => assert.fail('PIN must never be collected by CLI') };
  const journal = { async acquire(){}, async release(){releases++;}, async read(){return record;}, async write(value){record=structuredClone(value);} };
  const transport = { async call(method, params){
    calls.push({method,params});
    if(method === 'configure') return {status:0};
    if(method === 'start') return {status:10000};
    if(method === 'continue') return steps.shift() ?? {status:-2};
    if(method === 'finish') return {returned:true};
    return {status:1};
  }, async close(){} };
  return { resources: createPinpadResources({journal,transport,io}), io, calls, writes,
    get record(){return record;}, get releases(){return releases;} };
}
const event = fieldType => ({status:10000,command:0,fieldType,minLength:0,maxLength:0,buffer:'do-not-log-native-data'});
const context = paymentId => ({paymentId});

test('CLI pinpad: lock requires a real acquired session lease and tracks owner', async () => {
  const f=fixture(), p=f.resources;
  assert.throws(()=>p.hooks.lockResources({},context('a')), {code:'CLI_PINPAD_BUSY'});
  await p.journal.acquire();
  assert.equal(p.hooks.lockResources({},context('a')),true);
  assert.equal(p.hooks.lockResources({},context('a')),true);
  assert.throws(()=>p.hooks.lockResources({},context('b')), {code:'CLI_PINPAD_BUSY'});
  assert.throws(()=>p.hooks.unlockResources({},context('b')), {code:'CLI_PINPAD_BUSY'});
  await assert.rejects(p.journal.release(), {code:'CLI_PINPAD_BUSY'});
  assert.equal(f.releases,0);
  assert.equal(p.hooks.unlockResources({},context('a')),true);
  await p.journal.release();
  assert.equal(f.releases,1);
  assert.throws(()=>p.hooks.lockResources({},context('a')), {code:'CLI_PINPAD_BUSY'});
});

test('CLI pinpad: every auxiliary operation is blocked while the cycle owns the resource', async () => {
  const f=fixture(), p=f.resources;
  await p.journal.acquire(); p.hooks.lockResources({},context('a'));
  for(const method of ['pinpadPresent','start','readPassword','readSecureCard','configure','finish','unknown'])
    await assert.rejects(p.transport.call(method,{}), {code:'CLI_PINPAD_BUSY'});
  assert.equal(f.calls.length,0);
  await p.transport.call('continue',{continueFlag:0});
  assert.equal(f.calls.length,1);
  p.hooks.unlockResources({},context('a'));
  await p.transport.call('pinpadPresent',{});
  assert.equal(f.calls.length,2);
  await p.journal.release();
});

test('CLI pinpad: event messages use only fixed labels and never native fields', () => {
  const f=fixture();
  for(const fieldType of [5001,5018,5039,5042,5043,5051]) f.resources.onExchange(event(fieldType));
  f.resources.onExchange(event(99999));
  f.resources.onExchange({...event(5018),command:23});
  assert.equal(f.writes.length,6);
  assert.ok(f.writes.some(x=>x.includes('Aguardando senha no pinpad')));
  assert.ok(!f.writes.join('').includes('do-not-log-native-data'));
});

test('CLI pinpad: without a journal, only the configured local connection owns resources',async()=>{
  const calls=[];
  const resources=createPinpadResources({io:{write(){}},transport:{async call(method){calls.push(method);return{status:0};},async close(){calls.push('close');}}});
  assert.equal(resources.journal,undefined);
  assert.throws(()=>resources.hooks.lockResources({},context('a')),{code:'CLI_PINPAD_BUSY'});
  await resources.transport.call('configure',{});
  resources.hooks.lockResources({},context('a'));
  await assert.rejects(resources.transport.call('start',{}),{code:'CLI_PINPAD_BUSY'});
  await assert.rejects(resources.transport.close(),{code:'CLI_PINPAD_BUSY'});
  resources.hooks.unlockResources({},context('a'));
  await resources.transport.close();
  assert.throws(()=>resources.hooks.lockResources({},context('a')),{code:'CLI_PINPAD_BUSY'});
  assert.deepEqual(calls,['configure','close']);
});

test('CLI pinpad: journal-free SDK still rejects a simultaneous cycle and permits close when pending',async()=>{
  const calls=[],records=[];
  let finishStart,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const transport={async call(method){calls.push(method);
    if(method==='configure')return{status:0};
    if(method==='start'){entered();return new Promise(resolve=>{finishStart=()=>resolve({status:0});});}
    assert.fail(method);
  },async close(){calls.push('close');}};
  const resources=createPinpadResources({transport,io:{write(){}}});
  const client=await SitefClient.connect({transport:resources.transport,
    configuration:{server:'synthetic',storeId:'00000000',terminalId:'SR000001'},interaction:async()=>({}),
    onStateChange:snapshot=>records.push(snapshot),fields:{hooks:resources.hooks}});
  const operation=client.transact(fiscalInput('1,00',3));await started;
  await assert.rejects(client.transact(fiscalInput('2,00',3)),{code:'SESSION_BUSY'});
  await assert.rejects(client.close(),{code:'SESSION_BUSY'});
  finishStart();await operation;await client.close();
  assert.deepEqual(calls,['configure','start','close']);
  assert.equal(records.at(-1).state,'awaiting-finalization');
});

async function connect(f) {
  const p=f.resources;
  return SitefClient.connect({transport:p.transport,journal:p.journal,
    configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},
    interaction:createInteraction(f.io),onExchange:p.onExchange,
    fields:{receiptStoragePolicy:'explicit-return',hooks:p.hooks}});
}

test('CLI pinpad: synthetic lock/PIN/poll/unlock cycle reaches end without PIN input or missing hooks', async () => {
  const f=fixture([event(5042),event(5039),event(5018),{...event(-1),command:23},event(5051),event(5043),{status:-2}]);
  const client=await connect(f);
  await runSimulation(client,fiscalInput('1,00',3),f.io);
  assert.equal(f.record.state,'ended');
  assert.equal(f.record.payments[0].status,-2);
  assert.deepEqual(f.record.payments[0].assessmentIssues,[]);
  assert.ok(f.calls.filter(x=>x.method==='continue').every(x=>(x.params.continueFlag??0)===0));
  assert.ok(!f.calls.some(x=>['readPassword','finish'].includes(x.method)));
  await client.close(); assert.equal(f.releases,1);
});

test('CLI pinpad: callback failure cancels cooperatively and cleanup frees only its ownership', async () => {
  const f=fixture([event(5042),{...event(99999),command:999},{status:-2}]);
  const client=await connect(f);
  await assert.rejects(runSimulation(client,fiscalInput('1,00',3),f.io), {code:'INTERACTION_FAILED',nativeStatus:-2});
  assert.equal(f.calls.filter(x=>x.method==='continue').at(-1).params.continueFlag,-1);
  assert.equal(f.record.state,'ended');
  assert.ok(!f.calls.some(x=>x.method==='finish'));
  await client.close(); assert.equal(f.releases,1);
});

test('CLI pinpad: cleanup also releases ownership when provider omits explicit unlock', async () => {
  const f=fixture([event(5042),{status:-6}]);
  const client=await connect(f);
  await runSimulation(client,fiscalInput('1,00',3),f.io);
  assert.equal(f.record.payments[0].status,-6);
  await client.close(); assert.equal(f.releases,1);
});
test('CLI pinpad: successful synthetic cycle releases reservation but preserves pending financial decision', async () => {
  const f=fixture([event(5042),event(5018),event(5051),{status:0}]);
  const client=await connect(f);
  await runSimulation(client,fiscalInput('1,00',3),f.io);
  assert.equal(f.record.state,'awaiting-finalization');
  assert.equal(f.record.payments[0].decision,undefined);
  const finishes=f.calls.filter(x=>x.method==='finish');
  assert.equal(finishes.length,0);
  await client.close(); assert.equal(f.releases,1);
  assert.equal(f.record.state,'awaiting-finalization');
  assert.equal(f.calls.filter(x=>x.method==='finish').length,0);
});
