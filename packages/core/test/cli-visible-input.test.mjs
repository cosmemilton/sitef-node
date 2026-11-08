import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { terminalIO } from '../../../examples/cli/terminal.mjs';
import { createInteraction } from '../../../examples/cli/interaction.mjs';
import { SitefClient } from '../dist/index.js';

function terminal() {
  class Input extends EventEmitter {
    isTTY = true; isRaw = false;
    setRawMode(value) { this.isRaw = value; }
    resume() {} pause() {}
  }
  const input = new Input(), output = { isTTY: true, text: '', write(value) { this.text += value; } };
  const io = terminalIO(input, output);
  return { input, output, io, type(text) { input.emit('keypress', text, {}); }, enter() { input.emit('keypress', '', { name: 'return' }); } };
}
const base = { status: 10000, fieldType: 999999, minLength: 0, maxLength: 50, buffer: 'SYNTHETIC PROMPT' };

for (const [command, fieldType, text] of [[30, 516, '123456'], [41, 999999, 'Supervisor123'], [31, 999999, '1:123456'], [35, 999999, '0:123456']]) {
  test(`CLI visible input: command ${command}, field ${fieldType} shows exact typing even with sensitivity flags`, async () => {
    const t = terminal();
    const request = { ...base, command, fieldType, ...(fieldType === 516 ? { minLength: 5, maxLength: 9 } : {}),
      secret: true, semantic: { sensitive: true, definition: { sensitive: true } } };
    const result = createInteraction(t.io)(request, { signal: new AbortController().signal });
    t.type(text);
    assert.ok(t.output.text.endsWith(text));
    assert.doesNotMatch(t.output.text, /\*|Entrada oculta/);
    t.enter();
    assert.deepEqual(await result, { buffer: text });
    assert.equal(t.input.isRaw, false);
    assert.equal(t.input.listenerCount('keypress'), 0);
  });
}

test('CLI visible input: document length validation, editing and cancellation are unchanged', async () => {
  const t = terminal(), request = { ...base, command: 30, fieldType: 516, minLength: 5, maxLength: 9 };
  const result = createInteraction(t.io)(request, { signal: new AbortController().signal });
  t.type('1234'); t.enter();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(t.output.text, /Entrada invalida/);
  t.type('1234567'); t.input.emit('keypress', '', { name: 'backspace' }); t.enter();
  assert.deepEqual(await result, { buffer: '123456' });
  assert.ok(t.output.text.includes('1234567\b \b'));
  const cancelled = createInteraction(t.io)(request, { signal: new AbortController().signal });
  t.type('/cancelar'); t.enter();
  assert.deepEqual(await cancelled, { continueFlag: -1 });
});

test('CLI visible input: actual SDK retains original Buffer and native status without putting typed values in snapshots', async () => {
  const t = terminal(), sent = [], snapshots = [];
  const steps = [
    { ...base, command: 30, fieldType: 516, minLength: 5, maxLength: 9 },
    { ...base, command: 41, fieldType: 999999 },
    { status: -2 }
  ];
  const client = await SitefClient.connect({
    configuration: { server: 'synthetic', storeId: '00000000', terminalId: 'SR000001' },
    transport: { async call(method, params) {
      if (method === 'configure') return { status: 0 };
      if (method === 'start') return { status: 10000 };
      if (method === 'continue') { sent.push(params); return steps.shift(); }
      assert.fail('No other native call is allowed: ' + method);
    }, async close() {} },
    onStateChange: state => snapshots.push(structuredClone(state)),
    interaction: (request, context) => {
      const result = createInteraction(t.io)(request, context);
      t.type(request.command === 30 ? '123456' : 'SYNTHETIC_SUPERVISOR'); t.enter();
      return result;
    }
  });
  try {
    const result = await client.transact({ functionId: 3, amount: '1,00', fiscalDocument: 'SYNTHETIC_VISIBLE',
      fiscalDate: '20261108', fiscalTime: '120000', operator: 'TEST' });
    assert.equal(result.status, -2);
    assert.deepEqual(sent.map(p => p.buffer), ['', '123456', 'SYNTHETIC_SUPERVISOR']);
    assert.deepEqual(sent.map(p => p.continueFlag), [0, 0, 0]);
    assert.match(t.output.text, /123456/); assert.match(t.output.text, /SYNTHETIC_SUPERVISOR/);
    assert.doesNotMatch(t.output.text, /\*|Entrada oculta/);
    assert.doesNotMatch(JSON.stringify(snapshots), /123456|SYNTHETIC_SUPERVISOR/);
    assert.equal(result.data.getLast(999999).sensitive, true);
  } finally { await client.close(); }
});