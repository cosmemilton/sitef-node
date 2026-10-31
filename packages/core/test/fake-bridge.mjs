import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const mode = process.argv[2];
if (mode === 'graceful') process.on('exit', () => writeFileSync(process.argv[3], 'closed-normally'));
createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (mode === 'timeout') return;
  if (mode === 'exit') return process.exit(1);
  if (mode === 'invalid') return process.stdout.write('{broken}\n');
  if (mode === 'wrong-id') return process.stdout.write(JSON.stringify({id: request.id + 1, result: {}}) + '\n');
  if (mode === 'large') return process.stdout.write('x'.repeat(4096));
  if (mode === 'error') return process.stdout.write(JSON.stringify({id: request.id, error: {code: 'SYMBOL_UNAVAILABLE', message: 'Não exportado'}}) + '\n');
  const reply = Buffer.from(JSON.stringify({id: request.id, result: {method: request.method, params: request.params, accented: 'ação'}}) + '\n');
  // Divisão de um caractere multibyte em chunks.
  const split = reply.indexOf(Buffer.from('ç')) + 1;
  process.stdout.write(reply.subarray(0, split)); setTimeout(() => process.stdout.write(reply.subarray(split)), 1);
});
