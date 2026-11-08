import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTION_MENU, collectFunctionInput } from '../../../examples/cli/functions.mjs';
import { createInteraction } from '../../../examples/cli/interaction.mjs';
import { fiscalInput, runSimulation, cliErrorLines } from '../../../examples/windows-cli.mjs';
import { SitefClient } from '../dist/index.js';
import { decideFinalization } from '../../../examples/cli/finalization.mjs';
const signal = new AbortController().signal;
function io(answers=[]) {
  const prompts=[],writes=[];
  return {prompts,writes,write(text){writes.push(text);},async ask(prompt){prompts.push(prompt);assert.ok(answers.length,'unexpected prompt');return answers.shift();}};
}
const exchange=(command,fieldType,buffer='')=>({status:10000,command,fieldType,buffer,minLength:0,maxLength:100});

test('CLI functions: requested seven options with no TESTE confirmation',async()=>{
  assert.deepEqual(FUNCTION_MENU.map(x=>x.id),[0,2,3,110,111,122,123]);
  const terminal=io(['111']);
  assert.deepEqual(await collectFunctionInput(terminal),{functionId:111,amount:''});
  assert.equal(terminal.prompts.length,1);
  assert.ok(!terminal.prompts.join('').includes('TESTE'));
  assert.ok(terminal.writes.some(x=>x.includes('Cancelamento via Carteira Digital')));
});

test('CLI functions: only debit credit and wallet sale request amount upfront',async()=>{
  for(const id of [2,3,122]){
    const terminal=io([String(id),'10.5']);
    assert.deepEqual(await collectFunctionInput(terminal),{functionId:id,amount:'10,50'});
    assert.equal(terminal.prompts.length,2);
  }
  for(const id of [0,110,111,123]){
    const terminal=io([String(id)]);
    assert.deepEqual(await collectFunctionInput(terminal),{functionId:id,amount:''});
    assert.equal(terminal.prompts.length,1);
  }
});

test('CLI functions: validates local choice/amount without an extra approval prompt',async()=>{
  const terminal=io(['TESTE','999','3','not-money','1,234','1,25']);
  assert.deepEqual(await collectFunctionInput(terminal),{functionId:3,amount:'1,25'});
  assert.ok(terminal.prompts.every(x=>x.startsWith('Função')||x.startsWith('Valor')));
});

test('CLI functions: explicit function skips only local menu and invalid IDs fail before input',async()=>{
  const terminal=io(['1']);
  assert.deepEqual(await collectFunctionInput(terminal,122),{functionId:122,amount:'1,00'});
  assert.equal(terminal.prompts.length,1);
  assert.deepEqual(await collectFunctionInput(io(),123),{functionId:123,amount:''});
  await assert.rejects(collectFunctionInput(io(),999),{code:'CLI_UNSUPPORTED_FUNCTION'});
});

test('CLI functions: exiting selection or cancelling amount never produces input to start',async()=>{
  for(const value of ['',null,'/cancelar'])assert.equal(await collectFunctionInput(io([value])),null);
  for(const value of [null,'/cancelar'])assert.equal(await collectFunctionInput(io(['2',value])),null);
});

async function synthetic(steps,options={}){
  const calls=[],records=[];let record;
  const terminal=io(options.answers??[]);
  const client=await SitefClient.connect({
    transport:{async call(method,params){calls.push({method,params});if(method==='configure')return{status:0};if(method==='start')return{status:10000};if(method==='continue'){const next=steps.shift();if(next instanceof Error)throw next;return next;}if(method==='finish')return{returned:true};throw Error('unexpected method');},async close(){}},
    journal:{async acquire(){},async release(){},async read(){return record;},async write(value){record=structuredClone(value);records.push(record);}},
    configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},
    interaction:createInteraction(terminal),fields:{receiptStoragePolicy:'explicit-return',hooks:options.hooks}
  });
  return{client,calls,records,terminal,get record(){return record;}};
}

test('CLI functions: all seven selections preserve exact function/value in the actual SDK request',async()=>{
  for(const functionId of [0,2,3,110,111,122,123]){
    const f=await synthetic([{status:-2}]);
    const selection=await collectFunctionInput(io([String(functionId),...([2,3,122].includes(functionId)?['1,23']:[])]));
    await runSimulation(f.client,fiscalInput(selection.amount,selection.functionId),f.terminal);
    const start=f.calls.find(x=>x.method==='start');
    assert.equal(start.params.functionId,functionId);assert.equal(start.params.amount,selection.amount);
    assert.ok(!f.calls.some(x=>x.method==='finish'));await f.client.close();
  }
});

test('CLI manager: receipt-conditional success without receipt is journaled then ends without Finaliza',async()=>{
  const f=await synthetic([exchange(21,-1,'1:Teste;'),{status:0}],{answers:['1']});
  await runSimulation(f.client,fiscalInput('',110),f.terminal);
  assert.equal(f.records[0].state,'started');assert.equal(f.record.state,'ended');
  assert.equal(f.record.payments[0].status,0);assert.equal(f.record.payments[0].confirmationAllowed,false);
  assert.ok(!f.calls.some(x=>x.method==='finish'));await f.client.close();
});

test('CLI manager: receipt-like outputs require review, never automatic Finaliza even after print',async()=>{
  for(const fieldType of [120,121,122,625]){
    let printed=0;
    const f=await synthetic([exchange(0,fieldType,'synthetic-receipt-not-for-logs'),{status:0}],{hooks:{printReceipt(){printed++;return true;}}});
    const input=fiscalInput('',110);
    const result=await runSimulation(f.client,input,f.terminal);
    assert.equal(result.status,0);
    assert.equal(result.fields.find(field=>field.fieldType===fieldType).buffer,'synthetic-receipt-not-for-logs');
    assert.equal(result.data.getLast(fieldType).raw,'synthetic-receipt-not-for-logs');
    assert.equal(result.data.getAll(fieldType).length,1);
    assert.equal(result.details.receipts[0].buffer,'synthetic-receipt-not-for-logs');
    assert.equal(await decideFinalization(f.client,input,result,f.terminal,{decide(){assert.fail('manager review cannot ask a financial decision');}}),result);
    await f.client.close();
    assert.equal(f.client.state,'closed');
    assert.ok(f.terminal.writes.some(line=>line.includes('exige classificacao')));
    assert.equal(printed,1);assert.equal(f.record.state,'awaiting-finalization');
    assert.equal(f.record.payments[0].confirmationAllowed,false);
    assert.ok(f.record.payments[0].assessmentIssues.includes('ADMINISTRATIVE_REVIEW_REQUIRED'));
    assert.ok(!f.calls.some(x=>x.method==='finish'));
    assert.equal(f.terminal.writes.join('').includes('synthetic-receipt-not-for-logs'),[121,122].includes(fieldType));
  }
});

test('CLI manager: print failure followed by native success is still preserved, never finalized',async()=>{
  const f=await synthetic([exchange(0,121,'synthetic-private-receipt'),{status:0}]);
  await assert.rejects(runSimulation(f.client,fiscalInput('',110),f.terminal),{code:'INTERACTION_FAILED',nativeStatus:0});
  assert.equal(f.record.state,'awaiting-finalization');
  assert.equal(f.calls.filter(x=>x.method==='continue').at(-1).params.continueFlag,-1);
  assert.ok(!f.calls.some(x=>x.method==='finish'));
});
test('CLI manager: timeout remains uncertain and is never automatically retried or finalized',async()=>{
  const f=await synthetic([new Error('synthetic-timeout')]);
  await assert.rejects(runSimulation(f.client,fiscalInput('',110),f.terminal),{code:'TRANSACTION_UNCERTAIN'});
  assert.equal(f.record.state,'uncertain');assert.equal(f.calls.filter(x=>x.method==='start').length,1);
  assert.ok(!f.calls.some(x=>x.method==='finish'));
});

test('CLI manager: receipt policy cannot override known financial or nonfinancial functions',async()=>{
  for(const functionId of [3,111,122,123,999]){
    const f=await synthetic([]);
    await assert.rejects(f.client.transact(fiscalInput('',functionId),{requiresFinalization:'review-receipts'}));
    assert.ok(!f.calls.some(x=>x.method==='start'));await f.client.close();
  }
});

test('CLI wallet: QR display without renderer fails explicitly without leaking payload or asking confirmation',async()=>{
  const terminal=io();
  await assert.rejects(createInteraction(terminal)(exchange(50,584,'synthetic-private-qr'),{signal}),{code:'CLI_QR_RENDERER_REQUIRED'});
  assert.equal(terminal.prompts.length,0);assert.ok(!terminal.writes.join('').includes('synthetic-private-qr'));
});

test('CLI wallet: administrative receipt without printer cancels and does not fake print or payment confirmation',async()=>{
  const f=await synthetic([exchange(0,121,'synthetic-private-receipt'),{status:-2}]);
  let failure;try{await runSimulation(f.client,fiscalInput('',123),f.terminal);}catch(error){failure=error;}
  assert.equal(failure.code,'INTERACTION_FAILED');assert.equal(failure.nativeStatus,-2);
  assert.match(cliErrorLines(failure).join('\n'),/impressao imediata/);
  assert.equal(f.calls.filter(x=>x.method==='continue').at(-1).params.continueFlag,-1);
  assert.ok(!f.calls.some(x=>x.method==='finish'));assert.ok(!f.terminal.writes.join('').includes('synthetic-private-receipt'));
  await f.client.close();
});
