import { SitefClient, createSitef } from '../../dist/index.js';
import type { ClientOptions, CreateSitefOptions, GroupJournalRecord, FiscalScope, FinalizationResult, Transport } from '../../dist/index.js';

declare const transport: Transport;
declare const restored: GroupJournalRecord;
const configuration = { server:'host', storeId:'00000000', terminalId:'TERM0001' };
const options: ClientOptions = {
  transport, configuration, interaction:async()=>({}), initialState:restored,
  onStateChange: async snapshot => {
    const payments = snapshot.payments;
    // @ts-expect-error top-level snapshot metadata is readonly.
    snapshot.state = 'ended';
    void payments;
  }
};
const inMemory: ClientOptions = { transport, configuration, interaction:async()=>({}) };
const factory: CreateSitefOptions = {
  bridgeExecutable:'bridge', bridgeDirectory:'directory', libraryPath:'library',
  configuration, interaction:async()=>({})
};
async function sample() {
  const client = await SitefClient.connect(options);
  const scope: FiscalScope = { fiscalDocument:'123', fiscalDate:'20261107' };
  const decision: FinalizationResult = await client.finalizeTransaction(false,'transaction-id');
  await client.finalizeFiscal(true,scope);
  await client.finalizeRecovery(false,'group-id',undefined,{transactionId:'transaction-id'});
  // @ts-expect-error finalization needs an explicit boolean decision.
  await client.finalizeTransaction('confirm','transaction-id');
  // @ts-expect-error fiscal identity must include its date.
  await client.finalizeFiscal(false,{fiscalDocument:'123'});
  void decision;
}
void [inMemory, factory, createSitef, sample];


const automatedClient: ClientOptions = {
  ...inMemory, fields: { finalizationResponsibility: 'automation' }
};
const managedFactory: CreateSitefOptions = {
  ...factory, fields: { finalizationResponsibility: 'sdk' }
};
const automatedFactory: CreateSitefOptions = {
  ...factory, fields: { finalizationResponsibility: 'automation' }
};
const invalidResponsibility: ClientOptions = {
  ...inMemory, fields: {
    // @ts-expect-error responsibility has only sdk and automation values.
    finalizationResponsibility: 'pretend-printed'
  }
};
const responsibility: 'sdk' | 'automation' | undefined = restored.payments[0].finalizationResponsibility;
void [automatedClient, managedFactory, automatedFactory, invalidResponsibility, responsibility];
