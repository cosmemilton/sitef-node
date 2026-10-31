import {SitefClient} from '../packages/core/dist/index.js';
// Exemplo somente em memória: sem rede, biblioteca de fabricante ou pagamento real.
const steps = [
  {status: 10000, command: 1, fieldType: 0, minLength: 0, maxLength: 0, buffer: 'Simulação local'},
  {status: 10000, command: 0, fieldType: 99999, minLength: 0, maxLength: 0, buffer: 'Campo de demonstração'},
  {status: 0},
];
let saved;
const client = await SitefClient.connect({
  configuration: {server: 'simulado', storeId: '00000000', terminalId: 'AA000001'},
  transport: {
    async call(method) {
      if (method === 'configure') return {status: 0};
      if (method === 'start') return {status: 10000};
      if (method === 'continue') return steps.shift();
      if (method === 'finish') return {returned: true};
      throw new Error('Método fora da simulação.');
    }, async close() {},
  },
  // Em produção, use FileJournal ou persistência transacional equivalente.
  journal: {async acquire() {}, async read() {return saved;}, async write(record) {saved = record;}, async release() {}},
  interaction: async request => { console.log(`Comando ${request.command}: ${request.buffer}`); return {}; },
});
const result = await client.transact({functionId: 0, amount: '10,00', fiscalDocument: '123456', fiscalDate: '20261030', fiscalTime: '120000', operator: 'Demo'});
console.log({status: result.status, requiresFinalization: result.requiresFinalization});
console.log(await client.finalize(false));
await client.close();
