import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amountText, createInteraction, parseOptions, terminalText } from '../../../examples/cli/interaction.mjs';
import { fiscalInput, runSimulation } from '../../../examples/windows-cli.mjs';
import { SitefClient } from '../dist/index.js';
const signal = new AbortController().signal;
const request = (command, buffer = '', semantic) => ({
  status: 10000, command, fieldType: 99999, minLength: 0, maxLength: 40, buffer, semantic
});
function terminal(answers) {
  const writes = [], prompts = [];
  return {
    writes, prompts,
    write(value) { writes.push(value); },
    async ask(prompt, options) { prompts.push({ prompt, options }); assert.ok(answers.length, 'unexpected prompt'); return answers.shift(); }
  };
}
test('CLI: exact amounts, variable precision and invalid grouping', () => {
  for (const [raw, result] of [['10','10,00'],['10.5','10,50'],['010,50','10,50'],['99999999999999999999.1','99999999999999999999,10']])
    assert.equal(amountText(raw), result);
  assert.equal(amountText('2.7', 3), '2,700');
  assert.equal(amountText('2', 0), '2');
  for (const value of ['1,000.00','1.234','-2','2e2','Infinity','', '1 234']) assert.throws(() => amountText(value));
});
test('CLI: menus preserve exact IDs and identified labels containing colon', () => {
  assert.deepEqual(parseOptions(request(21, '5:Debito;19:Credito;')), [{id:'5',label:'Debito'},{id:'19',label:'Credito'}]);
  assert.deepEqual(parseOptions(request(42, 'class|A:Cartao: credito:123:1;')), [{id:'A',label:'Cartao: credito'}]);
  for (const [code, value] of [[21,''],[21,'1:A;1:B'],[42,'1:A:1:2'],[42,'x|1:A']])
    assert.throws(() => parseOptions(request(code, value)));
});
test('CLI: confirmation uses native 0/1 and re-prompts invalid choice', async () => {
  const io = terminal(['yes','s']);
  assert.deepEqual(await createInteraction(io)(request(20,'Continuar?'), {signal}), {buffer:'0'});
  assert.deepEqual(await createInteraction(terminal(['n']))(request(20), {signal}), {buffer:'1'});
});
test('CLI: menu validation and Mc confirmation stay local until valid', async () => {
  const io = terminal(['1','7','n','9','s']);
  const semantic = {format:'Mc', menuConfirmation:true};
  const result = await createInteraction(io)(request(30, '7:Debito;9:Credito;', semantic), {signal});
  assert.deepEqual(result, {buffer:'9',confirmed:true});
});
test('CLI: command41 is visible, native validation and diagnostic privacy remain', async () => {
  const io = terminal(['private-long-value','123']);
  const req = {...request(41,'Senha de teste'), minLength:3,maxLength:3};
  assert.deepEqual(await createInteraction(io)(req,{signal}),{buffer:'123'});
  assert.ok(io.prompts.every(p=>p.options.secret === false));
  assert.ok(!io.writes.join('\n').includes('private-long-value'));
  assert.ok(!io.writes.join('\n').includes('123'));
});
test('CLI: barcode cancellation and exact decimal collection', async () => {
  assert.deepEqual(await createInteraction(terminal(['2:']))(request(35),{signal}),{buffer:'2:'});
  const req = request(34,'Valor',{decimalPlaces:3});
  assert.deepEqual(await createInteraction(terminal(['3.2']))(req,{signal}),{buffer:'3,200'});
});
test('CLI: unsupported command and decoding failure never silently acknowledged', async () => {
  for (const code of [29,999]) await assert.rejects(createInteraction(terminal([]))(request(code),{signal}));
  await assert.rejects(createInteraction(terminal([]))({...request(30),decodingError:true},{signal}));
});
test('CLI: cancellation, back and already-aborted prompt', async () => {
  for (const raw of [null,'/cancelar'])
    assert.deepEqual(await createInteraction(terminal([raw]))(request(30),{signal}),{continueFlag:-1});
  assert.deepEqual(await createInteraction(terminal(['/voltar']))(request(30),{signal}),{continueFlag:1});
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(await createInteraction(terminal([]))(request(30),{signal:abort.signal}),{continueFlag:-1});
});
test('CLI: no terminal escape bytes from provider', () => {
  assert.equal(terminalText('\x1b[2Jabc\x07'), '[2Jabc');
});
test('CLI: fiscal date/time use local components and preserve decimal', () => {
  const input = fiscalInput('1,20',0,new Date(2026,10,6,12,34,56));
  assert.equal(input.fiscalDate,'20261106');
  assert.equal(input.fiscalTime,'123456');
  assert.equal(input.amount,'1,20');
});
test('CLI: simulation success returns the result and leaves the decision pending', async () => {
  const calls=[];
  const client = {
    state:'idle',
    async transact() { this.state='awaiting-finalization'; return {status:0}; },
    async finalize(decision) { calls.push(decision); this.state='idle'; }
  };
  await runSimulation(client, {}, terminal([]));
  assert.deepEqual(calls,[]);
});
test('CLI: callback error preserves pending decision and propagates', async () => {
  const calls=[];
  const client = {
    state:'idle',
    async transact() { this.state='awaiting-finalization'; throw new Error('callback'); },
    async finalize(decision) { calls.push(decision); this.state='idle'; }
  };
  await assert.rejects(runSimulation(client,{},terminal([])),/callback/);
  assert.deepEqual(calls,[]);
});
test('CLI: uncertainty is never finalized or automatically retried', async () => {
  let starts=0;
  const client={state:'idle',async transact(){starts++;this.state='uncertain';throw new Error('timeout');},async finalize(){assert.fail('finalization on uncertainty');}};
  await assert.rejects(runSimulation(client,{},terminal([])),/timeout/);
  assert.equal(starts,1);
});
test('CLI: actual SDK synthetic cycle handles menus and runtime fields without finalizing', async () => {
  const steps = [
    request(1,'Teste local'),
    request(21,'8:Credito;12:Debito;'),
    request(30,'Numero de teste'),
    {status:0}
  ];
  const calls=[];
  let record;
  const transport={
    async call(method,params) {
      calls.push({method,params});
      if(method==='configure') return {status:0};
      if(method==='start') return {status:10000};
      if(method==='continue') return steps.shift();
      if(method==='finish') return {returned:true};
      throw new Error('unsupported');
    },
    async close(){}
  };
  const io=terminal(['12','synthetic-value']);
  const client=await SitefClient.connect({
    transport,
    configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},
    journal:{async acquire(){},async release(){},async read(){return record;},async write(r){record=r;}},
    interaction:createInteraction(io)
  });
  await runSimulation(client,fiscalInput('1,00'),io);
  assert.equal(client.state,'awaiting-finalization');
  assert.equal(calls.filter(c=>c.method==='finish').length,0);

  assert.ok(!io.writes.join('').includes('synthetic-value'));
  await client.close();
  assert.equal(record.state,'awaiting-finalization');
  assert.equal(calls.filter(c=>c.method==='finish').length,0);
});

test('CLI: S format without unambiguous choices fails before asking', async () => {
  await assert.rejects(createInteraction(terminal([]))(request(30,'?',{format:'S'}),{signal}),/sem mapeamento/);
});
test('CLI: Mc allows native back on its confirmation', async () => {
  const result=await createInteraction(terminal(['2','/voltar']))(request(30,'2:Sim;',{format:'Mc',menuConfirmation:true}),{signal});
  assert.deepEqual(result,{continueFlag:1});
});
test('CLI: clear-header does not display stale native data',async()=>{
  const io=terminal([]);
  await createInteraction(io)(request(16,'stale-sensitive'),{signal});
  assert.ok(!io.writes.join('').includes('stale-sensitive'));
});
test('CLI: aborted preflight never starts a transaction', async () => {
  const abort=new AbortController(); abort.abort();
  let started=false;
  await runSimulation({async transact(){started=true;}}, {}, terminal([]), abort.signal);
  assert.equal(started,false);
});
test('CLI: visible TTY input ignores legacy secret option and abort restores raw mode/listeners', async () => {
  const {EventEmitter}=await import('node:events');
  const {terminalIO}=await import('../../../examples/cli/terminal.mjs');
  class Input extends EventEmitter {
    isTTY=true; isRaw=false;
    setRawMode(value){this.isRaw=value;}
    resume(){}
    pause(){}
  }
  const input=new Input(), output={isTTY:true,text:'',write(value){this.text+=value;}};
  const io=terminalIO(input,output), abort=new AbortController();
  const result=io.ask('Secret: ',{secret:true,signal:abort.signal});
  input.emit('keypress','xyz',{name:'x'});
  assert.ok(output.text.includes('xyz'));
  assert.ok(!output.text.includes('***'));
  abort.abort();
  assert.equal(await result,null);
  assert.equal(input.isRaw,false);
  assert.equal(input.listenerCount('keypress'),0);
});

test('CLI: missing runtime reports exact file and never implies a transaction started', async () => {
  const {cliErrorLines,checkDevelopmentFiles}=await import('../../../examples/windows-cli.mjs');
  const dir=await mkdtemp(join(tmpdir(),'sitef-cli-missing-'));
  try {
    let failure;
    try { await checkDevelopmentFiles(dir); } catch(error) { failure=error; }
    assert.equal(failure.code,'RUNTIME_FILE_MISSING');
    assert.equal(failure.path,join(dir,'runtime','7.0.117.123.r2-win64','CliSiTef64I.dll'));
    const message=cliErrorLines(failure).join('\n');
    assert.ok(message.includes(failure.path));
    assert.match(message,/Nenhuma operacao foi iniciada/);
    assert.ok(!message.includes('reconcilie'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('CLI: explicit prepared root takes precedence without silently moving journal', async () => {
  const {developmentRoot}=await import('../../../examples/windows-cli.mjs');
  const explicit=join(tmpdir(),'prepared-sitef');
  assert.equal(developmentRoot('unused',explicit),explicit);
  assert.equal(developmentRoot(tmpdir()),join(tmpdir(),'Documents','SiTefDevelopment'));
  assert.throws(()=>developmentRoot('',undefined),/USERPROFILE/);
  assert.throws(()=>developmentRoot(tmpdir(),'relative'),/absoluto/);
});
