import { ClientSitef, Operations, TransactionControl, type TransactionResult, type ClientSitefOptions, type UiResponse } from '../../dist/index.js';
declare const options: ClientSitefOptions;
const client = await ClientSitef.create(options);
const fields = { amount: '10,00', fiscalDocument: '123', fiscalDate: '20261030', fiscalTime: '120000', operator: 'test' };
const transaction = client.createTransaction({ operation: Operations.Credit, ...fields });
client.createTransaction({ operation: 98765, ...fields }, { requiresFinalization: false });
client.createTransaction({ functionId: 3, ...fields });
// @ts-expect-error Use a single unambiguous function selector.
client.createTransaction({ operation: 3, functionId: 3, ...fields });
const result: TransactionResult = await transaction.process({
  display(request) { const target: 'operator' | 'customer' | 'both' | 'menu-title' | 'header' = request.target; void target; },
  menu: () => '7',
  collect(request) { const secret: boolean = request.secret; return secret ? TransactionControl.CANCEL : 'text'; },
  confirm: () => true,
  event(request, { signal }) { void request; void signal; },
  application: () => ({ buffer: 'text' }), acknowledge() {}, qr() {}, raw: () => ({ continueFlag: 0 })
});
const nativeStatus: number | undefined = transaction.status;
const cancel: UiResponse = TransactionControl.CANCEL;
void nativeStatus; void cancel; void result;
// @ts-expect-error Menu returns a native ID string or UiResponse, never a numeric position.
transaction.process({ menu: () => 1 });
// @ts-expect-error No hidden native async constructor.
new ClientSitef(options);
await transaction.confirm();
transaction.dispose();
const pinpadMessage: { status: number } = await client.escreverMensagemPinpad('READY');
void pinpadMessage;
// @ts-expect-error Pinpad text must be a string.
client.escreverMensagemPinpad(123);
await client.close();
