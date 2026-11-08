import { SitefError } from '../../packages/core/dist/index.js';
import { amountText } from './interaction.mjs';

export const FUNCTION_MENU = Object.freeze([
  { id: 0, label: 'Permite que o operador escolha a operação através de menus.', collectAmount: false },
  { id: 2, label: 'Débito', collectAmount: true },
  { id: 3, label: 'Crédito', collectAmount: true },
  { id: 110, label: 'Abre o menu de transações Gerenciais', collectAmount: false },
  { id: 111, label: 'Teste de comunicação com o SiTef', collectAmount: false },
  { id: 122, label: 'Venda via Carteira Digital', collectAmount: true },
  { id: 123, label: 'Cancelamento via Carteira Digital', collectAmount: false }
].map(Object.freeze));

export function testFunction(id) {
  const entry = FUNCTION_MENU.find(item => item.id === id);
  if (!entry) throw new SitefError('CLI_UNSUPPORTED_FUNCTION', 'Escolha uma das funcoes do menu de teste.');
  return entry;
}

export async function collectFunctionInput(io, explicitFunctionId, { signal } = {}) {
  if (signal?.aborted) return null;
  let entry;
  if (explicitFunctionId !== undefined) entry = testFunction(explicitFunctionId);
  else {
    io.write('Menu de Funções:');
    for (const item of FUNCTION_MENU) io.write('  ' + item.id + '= ' + item.label);
    for (;;) {
      const raw = await io.ask('Função (Enter para sair): ', { signal });
      if (signal?.aborted || raw === null || raw === '' || raw === '/cancelar') return null;
      const id = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
      entry = FUNCTION_MENU.find(item => item.id === id);
      if (entry) break;
      io.write('Funcao invalida. Escolha um numero exibido no menu.');
    }
  }
  if (!entry.collectAmount) return { functionId: entry.id, amount: '' };
  for (;;) {
    const value = await io.ask('Valor (ex.: 10,00): ', { signal });
    if (signal?.aborted || value === null || value === '/cancelar') return null;
    try {
      const amount = amountText(value);
      return { functionId: entry.id, amount };
    } catch {
      io.write('Valor invalido. Use 10,00 ou 10.00, sem milhares.');
    }
  }
}
