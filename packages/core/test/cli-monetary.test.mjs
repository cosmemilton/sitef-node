import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { amountText, amountInputView, createInteraction } from '../../../examples/cli/interaction.mjs';
import { terminalIO } from '../../../examples/cli/terminal.mjs';
import { SitefClient } from '../dist/index.js';

const signal = new AbortController().signal;
const moneyRequest = (changes = {}) => ({
  status: 10000, command: 34, fieldType: 504, minLength: 1, maxLength: 40,
  buffer: 'Forneca a taxa de servico', semantic: { decimalPlaces: 2, sensitive: false }, ...changes
});
function scripted(answers) {
  return {
    writes: [], prompts: [],
    write(text) { this.writes.push(text); },
    async ask(prompt, options) {
      this.prompts.push({ prompt, options });
      assert.ok(answers.length, 'unexpected prompt');
      return answers.shift();
    }
  };
}
function tty(columns = 80) {
  class Input extends EventEmitter {
    isTTY = true; isRaw = false;
    setRawMode(value) { this.isRaw = value; }
    resume() {}
    pause() {}
  }
  const input = new Input();
  const output = { isTTY: true, columns, text: '', write(text) { this.text += text; } };
  return {
    input, output, io: terminalIO(input, output),
    type(text) { for (const ch of text) input.emit('keypress', ch, {}); },
    key(name, ctrl = false) { input.emit('keypress', '', { name, ctrl }); }
  };
}

test('CLI money: command34 field504 is visible, no added confirmation', async () => {
  for (const [raw, expected] of [['0,01','0,01'], ['1','1,00'], ['5.25','5,25'], ['00005,2','5,20'], ['0','0,00'], ['1,','1,00']]) {
    const io = scripted([raw]);
    const result = await createInteraction(io)(moneyRequest(), { signal });
    assert.deepEqual(result, { buffer: expected });
    assert.equal(io.prompts.length, 1);
    assert.equal(io.prompts[0].options.secret, false);
    assert.equal(io.prompts[0].options.decimalPlaces, 2);
    assert.match(io.writes.join('\n'), /Entrada visivel/);
    assert.doesNotMatch(io.writes.join('\n'), /Entrada oculta|TESTE/);
  }
});

test('CLI money: visual decimal mask keeps units explicit and caret before padding', () => {
  for (const [raw, text, cursor] of [['','0,00',0],['0','0,00',1],['1','1,00',1],['1,','1,00',2],['5.2','5,20',3],['5,25','5,25',4],['00001','1,00',1]])
    assert.deepEqual(amountInputView(raw), { text, cursor });
  assert.deepEqual(amountInputView('2.7',3), { text: '2,700', cursor: 3 });
  assert.deepEqual(amountInputView('12',0), { text: '12', cursor: 2 });
  assert.deepEqual(amountInputView('1,234'), { text: '1,234', cursor: 5 });
  assert.deepEqual(amountInputView('/cancelar'), { text: '/cancelar', cursor: 9 });
});

test('CLI money: all digits stay exact, no float rounding or cents shifting', async () => {
  const raw = '999999999999999999999999999999.99';
  const io = scripted([raw]);
  assert.deepEqual(await createInteraction(io)(moneyRequest(), { signal }), { buffer: raw.replace('.', ',') });
  assert.equal(amountText('525'), '525,00');
  assert.equal(amountText('0.01'), '0,01');
});

test('CLI money: invalid format or excess precision re-prompts without truncation', async () => {
  const invalid = ['', '1,234', '1.234,56', '1,234.56', '-1', '+1', '1e2', 'R$1', '1 2', '１２', 'abc', '1,,2', '.5'];
  const io = scripted([...invalid, '5,25']);
  assert.deepEqual(await createInteraction(io)(moneyRequest(), { signal }), { buffer: '5,25' });
  assert.equal(io.prompts.length, invalid.length + 1);
  assert.equal(io.writes.filter(text => text.startsWith('Entrada invalida:')).length, invalid.length);
  for (const raw of ['R$1', 'abc', '1.234,56']) assert.ok(!io.writes.join('\n').includes(raw));
});

test('CLI money: native byte limits apply after decimal normalization, never truncate', async () => {
  const tooLong = scripted(['10','1']);
  assert.deepEqual(await createInteraction(tooLong)(moneyRequest({ minLength: 4, maxLength: 4 }), { signal }), { buffer: '1,00' });
  assert.equal(tooLong.prompts.length, 2);
  const tooShort = scripted(['0,01','10']);
  assert.deepEqual(await createInteraction(tooShort)(moneyRequest({ minLength: 5, maxLength: 5 }), { signal }), { buffer: '10,00' });
  assert.equal(tooShort.prompts.length, 2);
  assert.equal(Buffer.byteLength('0,01', 'latin1'), 4);
});

test('CLI money: supplied product precision remains authoritative', async () => {
  for (const [decimalPlaces, raw, expected] of [[3,'2.7','2,700'],[0,'12','12']]) {
    const io = scripted([raw]);
    assert.deepEqual(await createInteraction(io)(moneyRequest({semantic:{decimalPlaces,sensitive:false}}),{signal}),{buffer:expected});
    assert.equal(io.prompts[0].options.decimalPlaces,decimalPlaces);
  }
});

test('CLI money: back, cancellation and abort carry controls, not fake monetary buffers', async () => {
  for (const [raw, continueFlag] of [['/cancelar',-1],[null,-1],['/voltar',1]])
    assert.deepEqual(await createInteraction(scripted([raw]))(moneyRequest(),{signal}),{continueFlag});
  const io=scripted([]);
  assert.deepEqual(await createInteraction(io)(moneyRequest(),{signal:AbortSignal.abort()}),{continueFlag:-1});
  assert.equal(io.prompts.length,0);
});

test('CLI money: command41 and sensitive metadata never hide keyboard input', async () => {
  for (const changes of [
    {command:41,semantic:{format:'V2',decimalPlaces:2,sensitive:false}},
    {semantic:{decimalPlaces:2,sensitive:true}},
    {semantic:{decimalPlaces:2,sensitive:false,definition:{sensitive:true}}}
  ]) {
    const io=scripted(['8,25']);
    assert.deepEqual(await createInteraction(io)(moneyRequest(changes),{signal}),{buffer:'8,25'});
    assert.equal(io.prompts[0].options.secret,false);
    assert.equal(io.prompts[0].options.decimalPlaces, changes.command === 41 ? undefined : 2);
    assert.match(io.writes.join('\n'),/Entrada visivel/);
    assert.doesNotMatch(io.writes.join('\n'),/Entrada oculta/);
    assert.ok(!io.writes.join('\n').includes('8,25'));
  }
});

test('CLI money: free-form, cheque and barcode fields are visible without diagnostic echo', async () => {
  for(const [command,raw] of [[30,'private'],[31,'1:private'],[35,'0:private']]) {
    const io=scripted([raw]);
    await createInteraction(io)(moneyRequest({command,fieldType:99999,semantic:undefined}),{signal});
    assert.equal(io.prompts[0].options.secret,false);
    assert.equal(io.prompts[0].options.decimalPlaces,undefined);
    assert.ok(!io.writes.join('\n').includes('private'));
  }
});

test('CLI money TTY: live formatting is visible and raw response stays unchanged', async () => {
  const t=tty();
  const answer=t.io.ask('Valor: ',{decimalPlaces:2,signal});
  assert.ok(t.output.text.includes('Valor: 0,00'));
  t.type('5.2');
  assert.ok(t.output.text.includes('Valor: 5,20'));
  t.type('5');
  assert.ok(t.output.text.includes('Valor: 5,25'));
  assert.ok(!t.output.text.includes('*'));
  t.key('return');
  assert.equal(await answer,'5.25');
  assert.equal(t.input.isRaw,false);
  assert.equal(t.input.listenerCount('keypress'),0);
});

test('CLI money TTY: backspace edits typed digits, not padding; placeholder is not a default', async () => {
  const t=tty();
  const answer=t.io.ask('Valor: ',{decimalPlaces:2});
  t.type('1,5'); t.key('backspace');
  assert.ok(t.output.text.endsWith('Valor: 1,00\x1b[2D'));
  t.type('01'); t.key('return');
  assert.equal(await answer,'1,01');
  const empty=t.io.ask('Valor: ',{decimalPlaces:2});
  t.key('return');
  assert.equal(await empty,'');
});

test('CLI money TTY: Esc, Ctrl+C, abort and EOF restore terminal without sending a value', async () => {
  for (const mode of ['escape','ctrl-c','abort','end','close']) {
    const t=tty(), abort=new AbortController();
    const answer=t.io.ask('Valor: ',{decimalPlaces:2,signal:abort.signal});
    t.type('5.25');
    if(mode==='abort') abort.abort();
    else if(mode==='ctrl-c') t.key('c',true);
    else if(mode==='escape') t.key('escape');
    else t.input.emit(mode);
    assert.equal(await answer,null);
    assert.equal(t.input.isRaw,false);
    for(const event of ['keypress','end','close']) assert.equal(t.input.listenerCount(event),0);
  }
});

test('CLI money TTY: legacy secret flag cannot hide decimal rendering', async () => {
  const t=tty();
  const answer=t.io.ask('Dado: ',{secret:true,decimalPlaces:2});
  t.type('825'); t.key('return');
  assert.equal(await answer,'825');
  assert.ok(!t.output.text.includes('***'));
  assert.ok(t.output.text.includes('825'));
  assert.ok(t.output.text.includes('0,00'));
});

test('CLI money: actual SDK synthetic field504 sequence preserves Buffer, codes and journal privacy', async () => {
  let record;
  const sent=[], ios=[];
  const steps=[moneyRequest({buffer:'Forneca a taxa de embarque'}),moneyRequest(),{status:-2}];
  const io=scripted(['0,01','5.25']);
  const client=await SitefClient.connect({
    transport:{async call(method,params){
      if(method==='configure') return {status:0};
      if(method==='start') return {status:10000};
      if(method==='continue'){sent.push(params);return steps.shift();}
      assert.fail('Unexpected native action '+method);
    },async close(){}},
    configuration:{server:'127.0.0.1',storeId:'00000000',terminalId:'SR000001'},
    journal:{async acquire(){},async release(){},async read(){return record;},async write(next){record=next;}},
    interaction:async(request,context)=>{ios.push(request);return createInteraction(io)(request,context);}
  });
  const result=await client.transact({functionId:3,amount:'1,00',fiscalDocument:'SYNTHETIC504',fiscalDate:'20261107',fiscalTime:'120000',operator:'TEST'});
  assert.equal(result.status,-2);
  assert.deepEqual(sent.map(p=>p.continueFlag),[0,0,0]);
  assert.deepEqual(sent.map(p=>p.buffer),['','0,01','5,25']);
  assert.ok(ios.every(r=>r.semantic.sensitive===false));
  assert.ok(io.prompts.every(p=>p.options.secret===false));
  assert.ok(!JSON.stringify(record).includes('0,01'));
  assert.ok(!JSON.stringify(record).includes('5,25'));
  assert.equal(record.state,'ended');
  await client.close();
});
test('CLI money: precision up to core limit100 remains exact and cancelable', async () => {
  for(const places of [21,100]) {
    const expected='1,'+'0'.repeat(places);
    assert.equal(amountText('1',places),expected);
    const io=scripted(['/cancelar']);
    assert.deepEqual(await createInteraction(io)(moneyRequest({semantic:{decimalPlaces:places},maxLength:200}),{signal}),{continueFlag:-1});
    const collected=scripted(['1']);
    assert.deepEqual(await createInteraction(collected)(moneyRequest({semantic:{decimalPlaces:places},maxLength:200}),{signal}),{buffer:expected});
  }
});

test('CLI money TTY: long values fit one narrow physical line without truncating response', async () => {
  const t=tty(12);
  const raw='123456789012345678901234567890.25';
  const answer=t.io.ask('Valor: ',{decimalPlaces:2});
  t.type(raw);t.key('return');
  assert.equal(await answer,raw);
  const redraws=t.output.text.split('\r\x1b[2K').slice(1);
  assert.ok(redraws.length>raw.length);
  for(const redraw of redraws) {
    const visible=redraw.replace(/\x1b\[\d+D/g,'').replace(/\n/g,'');
    assert.ok(visible.length<=11,JSON.stringify(visible));
  }
  assert.ok(redraws.some(text=>text.startsWith('<')));
  assert.ok(redraws.some(text=>text.includes('>')));
});

test('CLI money TTY: invalid Unicode is visible and remains invalid protocol input', async () => {
  const t=tty(12);
  const answer=t.io.ask('Valor: ',{decimalPlaces:2});
  t.type('１２');t.key('return');
  assert.equal(await answer,'１２');
  assert.ok(t.output.text.includes('１２'));
  assert.throws(()=>amountText('１２'));
});