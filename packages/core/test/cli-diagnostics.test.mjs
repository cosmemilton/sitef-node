import test from 'node:test';
import assert from 'node:assert/strict';
import { SitefError } from '../dist/index.js';
import { cliErrorLines } from '../../../examples/windows-cli.mjs';

test('CLI diagnostics: separate component failure from native cancellation without exposing original cause', () => {
  const secret='never-print-sensitive-payload';
  const error=new SitefError('INTERACTION_FAILED',secret,{nativeStatus:-2,cause:new Error(secret),
    interactionFailure:{stage:'process-field',command:0,fieldType:5042,reasonCode:'MISSING_FIELD_HANDLER'}});
  const text=cliErrorLines(error).join('\n');
  assert.match(text,/INTERACTION_FAILED identifica uma falha local/);
  assert.match(text,/Retorno nativo -2: Operacao cancelada pelo operador/);
  assert.match(text,/comando 0, campo 5042/);
  assert.match(text,/MISSING_FIELD_HANDLER/);
  assert.ok(!text.includes(secret));
});

test('CLI diagnostics: forged metadata is sanitized and never interpolated', () => {
  const secret='never-print-sensitive-payload';
  for(const interactionFailure of [
    {stage:secret,command:0,fieldType:1,reasonCode:secret},
    {stage:'interaction',command:secret,fieldType:secret,reasonCode:secret,buffer:secret,message:secret},
    {stage:'interaction',command:1234567890123456,fieldType:1234567890123456,reasonCode:'INVALID_RESPONSE'}
  ]) {
    const text=cliErrorLines({code:'INTERACTION_FAILED',message:secret,cause:new Error(secret),interactionFailure,nativeStatus:secret}).join('\n');
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('1234567890123456'));
  }
});

test('CLI diagnostics: missing metadata does not invent a cause and non-cancellation status is preserved', () => {
  const text=cliErrorLines(new SitefError('INTERACTION_FAILED','private',{nativeStatus:-6})).join('\n');
  assert.match(text,/nao contem metadados suficientes/);
  assert.match(text,/Retorno nativo -6/);
  assert.ok(!text.includes('Retorno nativo -2'));
});
test('CLI diagnostics: cleanup failure keeps primary diagnosis and exposes no secondary payload', () => {
  const secret = 'PRIVATE CLEANUP PAYLOAD';
  const error = Object.assign(new SitefError('INTERACTION_FAILED', secret, { nativeStatus: -6 }), {
    cleanupFailed: true, cause: new Error(secret)
  });
  const lines = cliErrorLines(error), text = lines.join('\n');
  assert.equal(lines[0], 'Falha na CLI: INTERACTION_FAILED');
  assert.match(text, /Retorno nativo -6/);
  assert.match(text, /encerramento dos recursos nao foi comprovado/);
  assert.match(text, /antes de abrir outra/);
  assert.doesNotMatch(text, /PRIVATE CLEANUP PAYLOAD/);
  assert.doesNotMatch(cliErrorLines({ code: 'LOAD_FAILED', cleanupFailed: secret }).join('\n'), /PRIVATE CLEANUP PAYLOAD|encerramento dos recursos/);
});
