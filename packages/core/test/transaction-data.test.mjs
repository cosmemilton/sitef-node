import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { SitefClient, getPartialTransaction, TransactionFields } from '../dist/index.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/vrs260-field-ids.json',import.meta.url),'utf8'));
const canonical=JSON.parse(readFileSync(new URL('../../../protocol/fields.json',import.meta.url),'utf8'));
const input={functionId:111,amount:'',fiscalDocument:'',fiscalDate:'',fiscalTime:'',operator:''};
const financial={functionId:3,amount:'1,00',fiscalDocument:'SYNTHETIC-DATA',fiscalDate:'20261107',fiscalTime:'120000',operator:'TEST'};
const output=(fieldType,buffer,extra={})=>({status:10000,command:0,fieldType,minLength:0,maxLength:100,buffer,...extra});
async function setup(steps,options={}) {
 let record,writes=0; const calls=[],observed=[];
 const client=await SitefClient.connect({
  configuration:{server:'synthetic',storeId:'00000000',terminalId:'TEST0001'},
  transport:{async call(method,params){
   calls.push({method,params:structuredClone(params)});
   if(method==='configure')return{status:0};if(method==='start')return{status:10000};
   if(method==='continue'){const next=steps.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected continuation');return next;}
   assert.fail('Unexpected native action '+method);
  },async close(){}},
  journal:{async acquire(){},async release(){},async read(){return record;},async write(next){writes++;if(options.failWrite===writes)throw Error('synthetic journal failure');record=structuredClone(next);}},
  fields:{receiptStoragePolicy:'explicit-return',...options.fields},
  interaction:options.interaction??(async()=>({})),
  onExchange:async(request)=>{observed.push(request);await options.onExchange?.(request);}
 });
 return {client,calls,observed,get record(){return record;}};
}

test('VRS260 independent PDF fixture covers every individual field and documented range',()=>{
 assert.equal(fixture.reference.revision,260);assert.equal(fixture.reference.section,'5.3.2');
 const ids=Object.values(fixture.individualFieldIdsByPage).flat();
 assert.equal(ids.length,444);assert.equal(new Set(ids).size,444);
 assert.deepEqual([...ids].sort((a,b)=>a-b),[...canonical.coverage.baseFieldIds].sort((a,b)=>a-b));
 assert.deepEqual(fixture.ranges.map(({from,to})=>[from,to]).sort((a,b)=>a[0]-b[0]),[[10,99],[800,849],[3000,3999]]);
});

test('every VRS260 field reaches the public caller even when interpretation requires a handler',async()=>{
 for(const fieldType of Object.values(fixture.individualFieldIdsByPage).flat()) {
  const raw='synthetic-'+fieldType;
  const f=await setup([output(fieldType,raw),{status:-2}]);
  let data;
  try {data=(await f.client.transact(input)).data;}
  catch(error){assert.equal(error.code,'INTERACTION_FAILED');const partial=getPartialTransaction(error);assert.equal(partial.status,-2);data=partial.data;}
  assert.ok(data instanceof TransactionFields,'missing public data for '+fieldType);
  assert.equal(data.occurrences.length,1);assert.equal(data.getAll(fieldType)[0].raw,raw);assert.equal(data.getLast(fieldType).direction,'output');
  assert.equal(f.calls.some(c=>c.method==='finish'),false);await f.client.close();
 }
});

test('every base range occurrence and future ID survive the actual public SDK without a whitelist',async()=>{
 const ids=fixture.ranges.flatMap(({from,to})=>Array.from({length:to-from+1},(_,i)=>from+i));
 ids.push(999999,-999999,999999);
 const rows=ids.map((id,i)=>output(id,'synthetic-'+i));
 const f=await setup([...rows,{status:-2}]);
 const result=await f.client.transact(input);
 assert.deepEqual(result.data.occurrences.map(x=>[x.fieldType,x.raw]),rows.map(x=>[x.fieldType,x.buffer]));
 assert.equal(result.data.getAll(999999).length,2);assert.equal(result.data.getLast(999999).known,false);
 await f.client.close();
});

test('outputs and collected inputs share occurrence order without conflating echo or submission',async()=>{
 const f=await setup([output(170,'native-A'),output(504,'Synthetic amount prompt',{command:34,minLength:4,maxLength:4}),output(504,'1,00'),output(170,'native-B'),{status:-2}],{interaction:async()=>({buffer:'1,00'})});
 const result=await f.client.transact(input);
 assert.deepEqual(result.data.occurrences.map(x=>[x.sequence,x.direction,x.fieldType,x.raw]),[[0,'output',170,'native-A'],[1,'input',504,'1,00'],[2,'output',504,'1,00'],[3,'output',170,'native-B']]);
 assert.deepEqual(result.data.getAll(504).map(x=>x.direction),['input','output']);
 assert.equal(result.data.getAll(504)[0].submission,'returned');assert.equal(result.data.getAll(504)[0].validation,'accepted');
 assert.equal(result.data.getAll(504)[0].continueFlag,0);
 assert.deepEqual(result.fields.map(x=>x.buffer),['native-A','1,00','native-B']);
 assert.ok(!JSON.stringify(f.record ?? {}).includes('native-A'));await f.client.close();
 assert.equal(result.data.getLast(170).raw,'native-B');
});

test('duplicates empty values identifiers and undecodable original bytes are never replaced by interpretation',async()=>{
 const f=await setup([output(134,'000001'),output(134,''),output(170,'\ufffd',{bufferBase64:'gQ==',decodingError:true}),output(999999,'opaque'),{status:-2}],{fields:{hooks:{resolveField:()=>({custom:'different-value'})}}});
 const result=await f.client.transact(input);
 assert.deepEqual(result.data.getAll(134).map(x=>x.raw),['000001','']);
 assert.equal(result.data.getLast(170).raw,'\ufffd');assert.equal(result.data.getLast(170).bufferBase64,'gQ==');assert.equal(result.data.getLast(170).decodingError,true);
 assert.equal(result.details.fields.find(x=>x.fieldType===170).value.custom,'different-value');
 assert.equal(result.data.getLast(999999).sensitive,'unknown');await f.client.close();
});

test('handler failure preserves the failing output before onExchange and keeps original native code',async()=>{
 const marker='SYNTHETIC_PRIVATE_VALUE';
 const f=await setup([output(999999,'earlier'),output(150,marker),{status:-2}]);
 let error;try{await f.client.transact(financial);}catch(e){error=e;}
 assert.equal(error.code,'INTERACTION_FAILED');assert.equal(error.nativeStatus,-2);
 const partial=getPartialTransaction(error);assert.equal(partial.status,-2);assert.equal(partial.terminalKnown,true);assert.equal(partial.state,'idle');
 assert.equal(partial.data.getLast(150).raw,marker);assert.equal(partial.data.getLast(150).sensitive,true);assert.equal(f.observed.length,1);
 for(const shown of [JSON.stringify(error),inspect(error,{depth:null,showHidden:true}),JSON.stringify(partial),inspect(partial,{depth:null}),inspect(partial,{customInspect:false,showHidden:true,depth:null}),JSON.stringify(f.record)]) assert.ok(!shown.includes(marker));
 assert.equal(Object.hasOwn(error,'data'),false);assert.equal(Object.hasOwn(error,'fields'),false);
 assert.throws(()=>{partial.state='running';},TypeError);await f.client.close();
});

test('validation failure retains the rejected response but never marks it submitted',async()=>{
 const marker='SYNTHETIC_TOO_LONG';
 const f=await setup([output(999999,'Prompt',{command:30,minLength:1,maxLength:1}),{status:-2}],{interaction:async()=>({buffer:marker})});
 let error;try{await f.client.transact(input);}catch(e){error=e;}
 assert.equal(error.interactionFailure.stage,'validate-response');
 const field=getPartialTransaction(error).data.getLast(999999);
 assert.equal(field.raw,marker);assert.equal(field.validation,'rejected');assert.equal(field.submission,'not-submitted');
 assert.equal(f.calls.filter(c=>c.method==='continue').at(-1).params.buffer,'');await f.client.close();
});

test('cancellation navigation and late output do not invent a submitted input',async()=>{
 const f=await setup([output(170,'before'),output(504,'Prompt',{command:34}),output(170,'after-cancel'),{status:-2}],{interaction:async()=>({continueFlag:-1})});
 const result=await f.client.transact(input);
 assert.deepEqual(result.data.getAll(170).map(x=>x.raw),['before','after-cancel']);
 assert.equal(result.data.getAll(504).length,0);assert.equal(result.details.fields.length,1);
 await f.client.close();
 const abort=new AbortController();
 const g=await setup([output(504,'Prompt',{command:34}),{status:-2}],{interaction:async()=>{abort.abort();return{buffer:'1,00'};}});
 const next=await g.client.transact(input,{signal:abort.signal});
 const response=next.data.getLast(504);
 if(response){assert.equal(response.submission,'not-submitted');assert.equal(response.validation,'accepted');}
 assert.equal(g.calls.filter(c=>c.method==='continue').at(-1).params.continueFlag,-1);await g.client.close();
});

test('transport loss retains attempted inputs and outputs without inventing terminal success or retry',async()=>{
 const f=await setup([output(170,'before'),output(504,'Prompt',{command:34}),new Error('synthetic timeout')],{interaction:async()=>({buffer:'1,00'})});
 let error;try{await f.client.transact(financial);}catch(e){error=e;}
 assert.equal(error.code,'TRANSACTION_UNCERTAIN');const partial=getPartialTransaction(error);
 assert.equal(partial.status,undefined);assert.equal(partial.lastNativeStatus,10000);assert.equal(partial.terminalKnown,false);assert.equal(partial.requiresRecovery,true);
 assert.equal(partial.data.getLast(170).raw,'before');assert.equal(partial.data.getLast(504).submission,'attempted');
 assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.some(c=>c.method==='finish'),false);assert.equal(f.record.state,'uncertain');await f.client.close();
});

test('post-terminal journal failure retains status and data with recovery required',async()=>{
 const f=await setup([output(170,'before-save-failure'),{status:0}],{failWrite:2});
 let error;try{await f.client.transact(financial);}catch(e){error=e;}
 assert.equal(error.code,'JOURNAL_UNCERTAIN');const partial=getPartialTransaction(error);
 assert.equal(partial.status,0);assert.equal(partial.terminalKnown,true);assert.equal(partial.requiresRecovery,true);
 assert.equal(partial.data.getLast(170).raw,'before-save-failure');assert.equal(f.calls.some(c=>c.method==='finish'),false);await f.client.close();
});

test('unknown positive/negative native statuses remain original with full data',async()=>{
 for(const status of [876543,-876543]) {
  const f=await setup([output(999999,'opaque'),{status}]);const result=await f.client.transact(input);
  assert.equal(result.status,status);assert.equal(result.data.getLast(999999).raw,'opaque');await f.client.close();
 }
 for(const value of [undefined,null,1,'error',{},new Error('unrelated')])assert.equal(getPartialTransaction(value),undefined);
});
test('pending query success preserves structured records, public data and legacy exchanges',async()=>{
 const rows=[output(210,'1'),output(160,'SYNTHETIC-PENDING'),output(161,'0001'),output(163,'20261107'),output(164,'120000'),output(211,'3'),output(1319,'1,00'),output(999999,'opaque-A'),output(999999,'opaque-B',{bufferBase64:'b3BhcXVlLUI=',decodingError:false})];
 const f=await setup([...rows,{status:0}]);
 const result=await f.client.queryPendingTransactions();
 assert.equal(result.status,0);assert.equal(result.count,1);
 assert.deepEqual(result.fields,rows);
 assert.deepEqual(result.transactions,[{fiscalDocument:'SYNTHETIC-PENDING',paymentIndex:'0001',fiscalDate:'20261107',fiscalTime:'120000',functionId:3,amount:'1,00',fields:rows.slice(1)}]);
 assert.ok(result.data instanceof TransactionFields);
 assert.deepEqual(result.data.occurrences.map(x=>[x.sequence,x.direction,x.fieldType,x.raw]),rows.map((x,i)=>[i,'output',x.fieldType,x.buffer]));
 assert.deepEqual(result.data.getAll(999999).map(x=>x.raw),['opaque-A','opaque-B']);
 assert.equal(result.data.getLast(999999).bufferBase64,'b3BhcXVlLUI=');
 assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.find(c=>c.method==='start').params.functionId,130);
 assert.equal(f.calls.filter(c=>c.method==='continue').length,rows.length+1);assert.equal(f.calls.some(c=>c.method==='finish'),false);
 assert.equal(f.record,undefined);assert.equal(f.client.state,'idle');await f.client.close();
});

test('pending query nonzero status returns incomplete legacy fields and public data without parsing or retry',async()=>{
 const rows=[output(160,'SYNTHETIC-INCOMPLETE'),output(999999,'opaque')];
 const f=await setup([...rows,{status:-876543}]);
 const result=await f.client.queryPendingTransactions({fiscalDocument:'SYNTHETIC-QUERY',fiscalDate:'20261107'});
 assert.equal(result.status,-876543);assert.deepEqual(result.transactions,[]);assert.equal(result.count,undefined);
 assert.deepEqual(result.fields,rows);assert.deepEqual(result.data.occurrences.map(x=>[x.fieldType,x.raw]),rows.map(x=>[x.fieldType,x.buffer]));
 assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.find(c=>c.method==='start').params.functionId,131);
 assert.equal(f.calls.filter(c=>c.method==='continue').length,rows.length+1);assert.equal(f.calls.some(c=>c.method==='finish'),false);
 assert.equal(f.record,undefined);assert.equal(f.client.state,'idle');await f.client.close();
});

test('pending query incomplete parsing exposes a private partial with the known terminal status',async()=>{
 const rows=[output(210,'1'),output(160,'SYNTHETIC-INCOMPLETE'),output(999999,'opaque')];
 const f=await setup([...rows,{status:0}]);
 let error;await assert.rejects(f.client.queryPendingTransactions(),e=>{error=e;return e.code==='PENDING_DATA_INCOMPLETE';});
 const partial=getPartialTransaction(error);assert.ok(partial);
 assert.equal(partial.started,true);assert.equal(partial.status,0);assert.equal(partial.lastNativeStatus,0);assert.equal(partial.terminalKnown,true);
 assert.equal(partial.state,'idle');assert.equal(partial.requiresFinalization,false);assert.equal(partial.requiresRecovery,false);
 assert.deepEqual(partial.data.occurrences.map(x=>[x.fieldType,x.raw]),rows.map(x=>[x.fieldType,x.buffer]));
 assert.equal(Object.hasOwn(error,'data'),false);assert.equal(Object.hasOwn(error,'fields'),false);
 assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.filter(c=>c.method==='continue').length,rows.length+1);assert.equal(f.calls.some(c=>c.method==='finish'),false);
 assert.equal(f.record,undefined);await f.client.close();
});

test('pending query transport failure preserves received data without inventing a terminal status or retry',async()=>{
 const timeout=new Error('synthetic pending-query timeout');
 const rows=[output(160,'SYNTHETIC-BEFORE-TIMEOUT'),output(999999,'opaque')];
 const f=await setup([...rows,timeout]);
 let error;await assert.rejects(f.client.queryPendingTransactions(),e=>{error=e;return e===timeout;});
 const partial=getPartialTransaction(error);assert.ok(partial);
 assert.equal(partial.started,true);assert.equal(partial.status,undefined);assert.equal(partial.lastNativeStatus,10000);assert.equal(partial.terminalKnown,false);
 assert.equal(partial.state,'uncertain');assert.equal(partial.requiresFinalization,false);assert.equal(partial.requiresRecovery,true);
 await assert.rejects(f.client.queryPendingTransactions(),{code:'RECONNECT_REQUIRED'});
 assert.deepEqual(partial.data.occurrences.map(x=>[x.fieldType,x.raw]),rows.map(x=>[x.fieldType,x.buffer]));
 assert.equal(Object.hasOwn(error,'data'),false);assert.equal(Object.hasOwn(error,'fields'),false);
 assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.filter(c=>c.method==='continue').length,rows.length+1);assert.equal(f.calls.some(c=>c.method==='finish'),false);
 assert.equal(f.record,undefined);await f.client.close();
});
