import test from 'node:test';
import assert from 'node:assert/strict';
import { decideFinalization, interactiveFinalizationDecision } from '../../../examples/cli/finalization.mjs';
import { runSimulation } from '../../../examples/windows-cli.mjs';


function fixture() {
  const calls=[], writes=[];
  const result={status:0,transactionId:'current-payment',requiresFinalization:true,fields:[{fieldType:170,buffer:'synthetic-private'}],data:{getAll(){return ['synthetic-private'];}}};
  const client={state:'awaiting-finalization',async finalize(){assert.fail('ambiguous finalize');},async finalizeTransaction(value,id){assert.equal(id,result.transactionId);calls.push(value);this.state='idle';}};
  const io={write(line){writes.push(line);}};
  return {calls,writes,result,client,io};
}
test('CLI decision: absent callback and explicit pending preserve full result without finish',async()=>{
  for(const decide of [undefined,async()=> 'pending',async()=>undefined]){
    const f=fixture();
    assert.equal(await decideFinalization(f.client,{functionId:3},f.result,f.io,{decide}),f.result);
    assert.deepEqual(f.calls,[]);assert.equal(f.client.state,'awaiting-finalization');
    assert.ok(!f.writes.join('').includes('synthetic-private'));
  }
});
test('CLI decision: only explicit confirm/undo maps to one finish and receives complete result',async()=>{
  for(const [decision,expected] of [['confirm',true],['undo',false]]){
    const f=fixture();let received;
    await decideFinalization(f.client,{functionId:3},f.result,f.io,{decide(result){received=result;return decision;}});
    assert.equal(received,f.result);assert.deepEqual(f.calls,[expected]);
    assert.ok(!f.writes.join('').includes('synthetic-private'));
  }
});
test('CLI decision: callback error, invalid answer and abort never imply undo',async()=>{
  for(const mode of ['throw','invalid','abort']){
    const f=fixture(),abort=new AbortController();
    const action=decideFinalization(f.client,{functionId:3},f.result,f.io,{signal:abort.signal,decide(){
      if(mode==='throw')throw Error('decision callback');
      if(mode==='invalid')return false;
      if(mode==='abort')abort.abort();else f.client.state='uncertain';
      return 'undo';
    }});
    if(['throw','invalid'].includes(mode))await assert.rejects(action);else await action;
    assert.deepEqual(f.calls,[]);
  }
});
test('CLI decision: errors, nonzero native statuses, nonpending result and manager review never ask',async()=>{
  for(const [status,state,functionId] of [[-2,'awaiting-finalization',3],[-6,'idle',3],[999,'uncertain',3],[0,'idle',111],[0,'awaiting-finalization',110]]){
    const f=fixture();f.result.status=status;f.client.state=state;f.result.requiresFinalization=state!=='idle';
    await decideFinalization(f.client,{functionId},f.result,f.io,{decide(){assert.fail('unexpected decision prompt');}});
    assert.deepEqual(f.calls,[]);
  }
});
test('CLI decision: blocked confirmation preserves error and pending state without fallback undo or payload log',async()=>{
  for(const code of ['TRANSACTION_DECISION_REQUIRED','MISSING_FIELD_HANDLER','SIGNATURE_REQUIRED','RECEIPT_PRINT_FAILED','UNKNOWN']){
    const f=fixture(),error=Object.assign(Error('synthetic-private'),{code});
    f.client.finalizeTransaction=async(value,id)=>{assert.equal(id,f.result.transactionId);f.calls.push(value);throw error;};
    await assert.rejects(decideFinalization(f.client,{functionId:3},f.result,f.io,{decide:()=> 'confirm'}),e=>e===error);
    assert.deepEqual(f.calls,[true]);assert.equal(f.client.state,'awaiting-finalization');
    assert.ok(!f.writes.join('').includes('synthetic-private'));
  }
});
test('CLI decision: historical uncertainty cannot redirect or block finalization of this result',async()=>{
  const f=fixture();f.client.state='uncertain';
  await decideFinalization(f.client,{functionId:3},f.result,f.io,{decide:()=> 'confirm'});
  assert.deepEqual(f.calls,[true]);
});

test('CLI decision: missing transaction ID never falls back to whole-group finalization',async()=>{
  const f=fixture();delete f.result.transactionId;
  await assert.rejects(decideFinalization(f.client,{functionId:3},f.result,f.io,{decide:()=> 'undo'}),{code:'CLI_TRANSACTION_ID_REQUIRED'});
  assert.deepEqual(f.calls,[]);
});

test('CLI decision: callback cannot retarget the original result by mutating its transactionId',async()=>{
  const f=fixture(),originalId=f.result.transactionId;
  f.client.finalizeTransaction=async(value,id)=>{assert.equal(value,true);assert.equal(id,originalId);};
  await decideFinalization(f.client,{functionId:3},f.result,f.io,{decide(result){result.transactionId='historical';return 'confirm';}});
});

test('CLI decision: interactive menu defaults to pending, validates input, never asks before cycle',async()=>{
  for(const [answers,expected] of [[[''],'pending'],[[null],'pending'],[['/cancelar'],'pending'],[['/voltar'],'pending'],[['wrong','1'],'confirm'],[['2'],'undo']]){
    const f=fixture();f.io.ask=async()=>answers.shift();
    assert.equal(await interactiveFinalizationDecision(f.io)(),expected);
  }
  const abort=new AbortController();abort.abort();
  assert.equal(await interactiveFinalizationDecision({ask(){assert.fail();}},abort.signal)(),'pending');
});
test('CLI: runSimulation returns exact automation result without leaking values or finalizing',async()=>{
  const f=fixture();f.client.transact=async()=>f.result;
  const result=await runSimulation(f.client,{functionId:3},f.io);
  assert.equal(result,f.result);assert.deepEqual(result.data.getAll(),['synthetic-private']);
  assert.deepEqual(f.calls,[]);assert.ok(f.writes.join('').includes('170'));
  assert.ok(!f.writes.join('').includes('synthetic-private'));
});

test('CLI actual SDK default policy: receipt is displayed but missing printer still blocks confirmation',async()=>{
  const {SitefClient}=await import('../dist/index.js');
  const {fiscalInput}=await import('../../../examples/windows-cli.mjs');
  const calls=[],writes=[];let record,releases=0;
  const steps=[{status:10000,command:0,fieldType:121,buffer:'synthetic-private',minLength:0,maxLength:100},{status:0}];
  const client=await SitefClient.connect({
    transport:{async call(method,params){calls.push({method,params});if(method==='configure')return{status:0};if(method==='start')return{status:10000};if(method==='continue')return steps.shift();if(method==='finish')return{returned:true};throw Error('unexpected call');},async close(){}},
    journal:{async acquire(){},async release(){releases++;},async read(){return record;},async write(value){record=structuredClone(value);}},
    configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},
    interaction:async()=>({}),fields:{receiptStoragePolicy:'explicit-return'}
  });
  const io={write(line){writes.push(line);}},input=fiscalInput('1,00',3);
  const result=await runSimulation(client,input,io);
  assert.equal(result.status,0);assert.equal(client.state,'awaiting-finalization');
  await assert.rejects(decideFinalization(client,input,result,io,{decide:()=> 'confirm'}),{code:'MISSING_FIELD_HANDLER'});
  assert.equal(calls.filter(c=>c.method==='finish').length,0);
  assert.equal(record.state,'awaiting-finalization');
  assert.equal(releases,0);
  assert.ok(writes.join('').includes('synthetic-private'));
  assert.equal(result.details.receipts[0].printed,false);
  await decideFinalization(client,input,result,io,{decide:()=> 'undo'});
  const finishes=calls.filter(c=>c.method==='finish');
  assert.equal(finishes.length,1);assert.equal(finishes[0].params.confirm,0);
  await client.close();assert.equal(releases,1);
});

test('CLI actual SDK: finalization targets this result despite old uncertainty; ambiguous fiscal scope never broadens',async()=>{
  const {SitefClient}=await import('../dist/index.js');
  const {fiscalInput}=await import('../../../examples/windows-cli.mjs');
  for(const sameDocument of [false,true]){
    const calls=[],snapshots=[],input=fiscalInput('1,00',3);
    const previous={id:'previous',functionId:3,entryPoint:'start',fiscalDocument:sameDocument?input.fiscalDocument:'older',
      fiscalDate:input.fiscalDate,fiscalTime:input.fiscalTime,state:'uncertain',confirmationAllowed:false};
    const initialState={version:2,id:'group',storeId:'00000000',terminalId:'SR000001',functionId:3,
      fiscalDocument:previous.fiscalDocument,fiscalDate:input.fiscalDate,fiscalTime:input.fiscalTime,
      state:'uncertain',updatedAt:new Date().toISOString(),payments:[previous]};
    const client=await SitefClient.connect({
      transport:{async call(method,params){calls.push({method,params});
        if(method==='configure'||method==='start')return{status:0};if(method==='finish')return{returned:true};assert.fail(method);
      },async close(){}},
      configuration:{server:'synthetic',storeId:'00000000',terminalId:'SR000001'},initialState,
      onStateChange:snapshot=>snapshots.push(snapshot),interaction:async()=>({})
    });
    const result=await runSimulation(client,input,{write(){}});
    assert.equal(client.state,'uncertain');assert.equal(result.requiresFinalization,true);
    const decision=decideFinalization(client,input,result,{write(){}},{decide:()=> 'undo'});
    if(sameDocument)await assert.rejects(decision,{code:'PAYMENT_INDEX_REQUIRED'});else await decision;
    const finishes=calls.filter(call=>call.method==='finish');assert.equal(finishes.length,sameDocument?0:1);
    if(!sameDocument){assert.equal(finishes[0].params.fiscalDocument,input.fiscalDocument);assert.equal(finishes[0].params.confirm,0);}
    assert.deepEqual(snapshots.at(-1).payments[0],previous);
    assert.equal(snapshots.at(-1).payments.find(payment=>payment.id===result.transactionId).state,
      sameDocument?'awaiting-finalization':'finalized-local');
    await client.close();assert.deepEqual(initialState.payments,[previous]);
  }
});

test('CLI actual connection: receipts are presented before one explicit decision; automation owns deferred obligations',async()=>{
  const {connectClient,runSession,fiscalInput}=await import('../../../examples/windows-cli.mjs');
  for(const receiptFields of [[],[121],[122],[121,122],[122,121,121]]) {
    for(const answer of ['1','2','']) {
      const calls=[],writes=[],snapshots=[];let asked=0;
      const input=fiscalInput('1,00',3);
      const exchange=(fieldType,buffer)=>({status:10000,command:0,fieldType,buffer,minLength:0,maxLength:500});
      const receiptTexts=receiptFields.map((id,index)=>'SYNTHETIC RECEIPT '+id+' #'+index+'\n  TOTAL 1,00');
      const steps=[exchange(175,'2'),exchange(170,'private-nonreceipt'),exchange(5074,''),
        ...receiptFields.map((id,index)=>exchange(id,receiptTexts[index])),{status:0}];
      const transport={async call(method,params){calls.push({method,params});
        if(method==='load')return{protocolVersion:1,platform:'windows',architecture:'x86_64',fieldTypeBytes:4};
        if(method==='configure')return{status:0};if(method==='start')return{status:10000};
        if(method==='continue')return steps.shift();
        if(method==='finish'){assert.equal(asked,1);return{returned:true};}
        assert.fail(method);
      },async close(){calls.push({method:'close'});}};
      const io={write(text){writes.push(text);},async ask(prompt){
        asked++;assert.match(prompt,/Finalizacao/);
        for(const text of receiptTexts)assert.ok(writes.includes(text),'receipt must precede decision');
        assert.ok(writes.some(text=>text.includes('5074')));
        return answer;
      }};
      const client=await connectClient({transport,directory:process.cwd(),
        configuration:{server:'synthetic',storeId:'00000000',terminalId:'SR000001'},io,
        onStateChange(value){snapshots.push(structuredClone(value));}});
      await runSession({client,transport,input,io});
      assert.equal(asked,1);assert.equal(steps.length,0);
      assert.ok(!writes.join('').includes('private-nonreceipt'));
      assert.deepEqual(writes.filter(line=>line.startsWith('SYNTHETIC RECEIPT')),receiptTexts);
      const finishes=calls.filter(call=>call.method==='finish');
      assert.equal(finishes.length,answer===''?0:1);
      if(answer!=='') {
        assert.equal(finishes[0].params.confirm,answer==='1'?1:0);
        assert.equal(finishes[0].params.fiscalDocument,input.fiscalDocument);
      }
      const payment=snapshots.at(-1).payments[0];
      assert.equal(payment.state,answer===''?'awaiting-finalization':'finalized-local');
      assert.ok(payment.assessmentIssues.includes('PRODUCT_CONSTRAINT_REVIEW_REQUIRED:APPLICATION_MUST_REVIEW_DOCUMENTED_PRODUCT_CONSTRAINTS'));
      assert.equal(payment.signatureRequired,true);assert.notEqual(payment.signatureCaptured,true);
      assert.ok(payment.receipts.every(receipt=>receipt.printed===false));
      assert.equal(JSON.stringify(snapshots).includes('SYNTHETIC RECEIPT'),false);
      assert.equal(JSON.stringify(snapshots).includes('private-nonreceipt'),false);
      assert.equal(calls.filter(call=>call.method==='start').length,1);
    }
  }
});