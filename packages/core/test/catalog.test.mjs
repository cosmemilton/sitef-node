import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReturn, getCommandInfo, CONTINUATION } from '../dist/index.js';

test('o mesmo retorno positivo tem semântica própria por função nativa', () => {
  assert.equal(classifyReturn(1, 'transaction').kind, 'authorizer-declined');
  assert.equal(classifyReturn(1, 'pending-count').kind, 'count');
  assert.equal(classifyReturn(1, 'pinpad-presence').kind, 'present');
  assert.equal(classifyReturn(1, 'pinpad-confirmation').kind, 'confirmed');
  assert.equal(classifyReturn(1, 'configuration').kind, 'error');
  assert.equal(classifyReturn(1, 'barcode-validation').kind, 'invalid-data');
  assert.equal(classifyReturn(12, 'secure-transaction').kind, 'error');
  assert.equal(classifyReturn(12, 'secure-transaction').known, true);
  assert.equal(classifyReturn(10000, 'secure-transaction').kind, 'continue');
});

test('retornos futuros preservam valor e não viram sucesso', () => {
  for (const code of [-43210, 43210]) {
    const result = classifyReturn(code);
    assert.equal(result.code, code);
    assert.equal(result.known, false);
    assert.notEqual(result.kind, 'success');
    assert.match(result.message, new RegExp(String(code)));
  }
  assert.equal(classifyReturn(10000).kind, 'continue');
  assert.equal(classifyReturn(10000, 'pending-count').kind, 'count');
  assert.equal(classifyReturn(10000, 'configuration').kind, 'error');
});

test('cancelamento e teclas do pinpad não seguem o domínio de transação', () => {
  assert.equal(classifyReturn(0, 'pinpad-confirmation').kind, 'cancelled');
  assert.equal(classifyReturn(0, 'pinpad-presence').kind, 'absent');
  assert.equal(classifyReturn(13, 'pinpad-key').kind, 'key');
  assert.equal(
    classifyReturn(-1, 'pinpad-presence').message,
    'Biblioteca de acesso ao pinpad ausente'
  );
  assert.equal(
    classifyReturn(-1, 'transaction').message,
    'Biblioteca ainda não configurada'
  );
  assert.throws(() => classifyReturn(NaN), TypeError);
});

test('QR e polling continuam o laço sem esperar coleta humana', () => {
  for (const command of [23, 50, 51, 52])
    assert.equal(getCommandInfo(command).blocking, false);
  assert.equal(getCommandInfo(29).kind, 'system-input');
  assert.equal(getCommandInfo(41).kind, 'masked-input');
  const future = getCommandInfo(99999);
  assert.equal(future.kind, 'unknown');
  assert.equal(future.blocking, true);
  assert.equal(CONTINUATION.PRECOLLECTED_CONFIRMED, 10000);
});
