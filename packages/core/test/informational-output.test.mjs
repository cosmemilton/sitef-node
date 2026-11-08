import test from 'node:test';
import assert from 'node:assert/strict';
import {SitefClient,FieldProcessor,fieldDefinition,functionDefinition} from '../dist/index.js';
import {createInteraction} from '../../../examples/cli/interaction.mjs';
import {createPinpadResources} from '../../../examples/cli/pinpad.mjs';
import {fiscalInput,runSimulation} from '../../../examples/windows-cli.mjs';
const IDS=[170,174,724,725,726,727,2974];
const input=fiscalInput('1,00',3,new Date(2026,10,7,12,0,0));
const field=(fieldType,buffer,extra={})=>({status:10000,command:0,fieldType,minLength:0,maxLength:100,buffer,kind:'field',...extra});
const context={functionId:3,paymentId:'synthetic-payment',groupId:'synthetic-group',input,definition:functionDefinition(3),signal:new AbortController().signal};

async function fixture(steps,{hooks,answers=[]}={}){
 let record;const calls=[],writes=[],prompts=[],observed=[];
 const io={write(text){writes.push(text);},async ask(prompt){prompts.push(prompt);assert.ok(answers.length,'unexpected operator collection');return answers.shift();}};
 const transport={async call(method,params){calls.push({method,params:structuredClone(params)});if(method==='configure')return{status:0};if(method==='start')return{status:10000};if(method==='continue'){if(params.continueFlag===-1)return{status:-2};return steps.shift()??{status:0};}if(method==='finish')return{returned:true};throw Error('unexpected native method');},async close(){}};
 const journal={async acquire(){},async release(){},async read(){return record;},async write(r){record=structuredClone(r);}};
 const resources=createPinpadResources({transport,journal,io});
 const client=await SitefClient.connect({transport:resources.transport,journal:resources.journal,
  configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},interaction:createInteraction(io),
  onExchange(request){observed.push(request);resources.onExchange(request);},
  fields:{receiptStoragePolicy:'explicit-return',nativeEncoding:'windows-1252',hooks:{...resources.hooks,...hooks}}
 });
 return{client,calls,writes,prompts,observed,io,get record(){return record;}};
}

test('informational availability enums preserve unknown codes without a mandatory resolver',async()=>{
 for(const id of IDS){
  const def=fieldDefinition(id);assert.equal(def.resolverRequired,false);assert.equal(def.action.optionalHook,'resolveField');assert.equal(def.choices,undefined);
  for(const raw of ['0','1','unmapped-extension','']){
   const processor=new FieldProcessor({receiptStoragePolicy:'explicit-return'},context);
   await processor.process(field(id,raw));
   const value=processor.snapshot.fields.at(-1);
   assert.equal(value.raw,raw);assert.equal(value.value.code,raw);assert.equal(value.value.label,undefined);
  }
 }
});

test('field170 regression: VISA display then output170 reaches the next native prompt instead of local cancellation',async()=>{
 const raw='synthetic-unmapped-170';
 const f=await fixture([
  field(-1,'SELECIONADO: VISA CREDITO',{command:1}),field(170,raw),
  field(-1,'1:A vista;2:Parcelado;',{command:21}),{status:-6}
 ],{answers:['1']});
 const result=await f.client.transact(input);
 assert.equal(result.status,-6);assert.equal(f.record.state,'ended');
 assert.ok(!f.record.payments[0].assessmentIssues.includes('INTERACTION_FAILED'));
 const continuations=f.calls.filter(x=>x.method==='continue');
 assert.deepEqual(continuations.map(x=>x.params.continueFlag),[0,0,0,0]);
 assert.equal(continuations[2].params.buffer,raw);assert.equal(continuations[3].params.buffer,'1');
 assert.equal(f.prompts.length,1);assert.equal(f.prompts[0],'ID da opcao: ');
 assert.equal(result.fields.find(x=>x.fieldType===170).buffer,raw);
 assert.equal(result.details.fields.find(x=>x.fieldType===170).value.code,raw);
 assert.ok(!f.writes.join('').includes(raw));assert.ok(!JSON.stringify(f.record).includes(raw));
 await f.client.close();
});

test('all seven availability outputs preserve repeated order and never invent a returned enum mapping',async()=>{
 const values=IDS.map((id,index)=>[id,'synthetic-'+index]);values.push([170,'synthetic-repeat']);
 const f=await fixture([...values.map(([id,raw])=>field(id,raw)),{status:-2}]);
 const result=await f.client.transact(input);
 assert.equal(result.status,-2);assert.deepEqual(result.fields.map(x=>[x.fieldType,x.buffer]),values);
 const echo=f.calls.filter(x=>x.method==='continue').slice(1);
 assert.deepEqual(echo.map(x=>x.params.buffer),values.map(x=>x[1]));
 assert.ok(echo.every(x=>x.params.continueFlag===0));assert.equal(f.prompts.length,0);
 await f.client.close();
});

test('optional resolver enriches only typed value and never substitutes the native echo',async()=>{
 const f=await fixture([field(170,'APPLICATION_DEFINED_FLAG'),{status:-2}],{hooks:{resolveField(request){assert.equal(request.fieldType,170);return{applicationMeaning:'custom-defined'};}}});
 const result=await f.client.transact(input);
 assert.deepEqual(result.details.fields[0].value,{applicationMeaning:'custom-defined'});
 assert.equal(result.details.fields[0].raw,'APPLICATION_DEFINED_FLAG');
 assert.equal(f.calls.filter(x=>x.method==='continue')[1].params.buffer,'APPLICATION_DEFINED_FLAG');
 await f.client.close();
});

test('optional resolver returning undefined retains uninterpreted code',async()=>{
 const processor=new FieldProcessor({hooks:{resolveField:()=>undefined}},context);
 await processor.process(field(174,'unknown-code'));
 assert.equal(processor.snapshot.fields[0].value.code,'unknown-code');
 assert.equal(processor.snapshot.fields[0].value.label,undefined);
});

test('output170 preserves original Base64 bytes even with decoding loss',async()=>{
 const f=await fixture([field(170,'\ufffd',{bufferBase64:'gQ==',decodingError:true}),{status:-2}]);
 const result=await f.client.transact(input);
 const echo=f.calls.filter(x=>x.method==='continue')[1].params;
 assert.equal(echo.buffer,'\ufffd');assert.equal(echo.bufferBase64,'gQ==');assert.equal(echo.continueFlag,0);
 assert.equal(result.fields[0].bufferBase64,'gQ==');assert.equal(result.fields[0].decodingError,true);
 assert.equal(f.prompts.length,0);await f.client.close();
});

test('an explicitly provided failing resolver still cancels cooperatively with original native status',async()=>{
 const cause=new Error('synthetic-private-detail');
 const f=await fixture([field(170,'synthetic-private-field')],{hooks:{resolveField(){throw cause;}}});
 await assert.rejects(f.client.transact(input),error=>error.code==='INTERACTION_FAILED'&&error.nativeStatus===-2&&error.cause===cause&&error.interactionFailure.fieldType===170);
 assert.equal(f.calls.filter(x=>x.method==='continue').at(-1).params.continueFlag,-1);
 assert.ok(!f.writes.join('').includes('synthetic-private'));await f.client.close();
});

test('required device hooks and command29 are not converted into silent success by the enum change',async()=>{
 const processor=new FieldProcessor({},context);
 await assert.rejects(processor.process(field(5042,'')),{code:'MISSING_FIELD_HANDLER'});
 const f=await fixture([field(170,'synthetic-system-input',{command:29})]);
 await assert.rejects(f.client.transact(input),error=>error.code==='INTERACTION_FAILED'&&error.nativeStatus===-2&&error.interactionFailure.reasonCode==='CLI_UNSUPPORTED_COMMAND');
 assert.equal(f.prompts.length,0);await f.client.close();
});

test('CLI successful synthetic cycle passes field170 and leaves finalization pending',async()=>{
 const f=await fixture([field(170,'synthetic-output'),{status:0}]);
 await runSimulation(f.client,input,f.io);
 const finishes=f.calls.filter(x=>x.method==='finish');assert.equal(finishes.length,0);
 assert.equal(f.record.state,'awaiting-finalization');assert.equal(f.record.payments[0].decision,undefined);
 assert.ok(!JSON.stringify(f.record).includes('synthetic-output'));assert.ok(!f.writes.join('').includes('synthetic-output'));
 await f.client.close();
 assert.equal(f.record.state,'awaiting-finalization');
 assert.equal(f.calls.filter(x=>x.method==='finish').length,0);
});
