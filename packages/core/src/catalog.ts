/**
 * Semantic catalog audited against the supplied VRS-258 and Wallets 1.43 manuals.
 * This is a versioned aid, never a whitelist. Always keep the original numeric
 * code, command, field type and buffer. Product/authorizer extensions are open.
 */
export const PROTOCOL_REFERENCE = {
  interfaceRevision: 258,
  walletsRevision: '1.43',
  minimumContinuationBufferBytes: 20_000,
  documentSourceArchitecture: 'x86',
  documentCallingConvention: 'stdcall (x86 PDF)',
  supportedRuntime: 'Windows x64',
  runtimeCallingConvention: 'Windows x64 system ABI',
  runtimeScalarBits: { short: 16, int: 32, long: 32, pointer: 64 },
  completeVendorParameterCatalogAvailable: false,
} as const;

export const CONFIGURATION_RETURNS: Readonly<Record<number, string>> = Object.freeze({
  0: 'Configuração aceita',
  1: 'Endereço do servidor inválido ou não resolvido',
  2: 'Identificação da loja inválida',
  3: 'Identificação do terminal inválida',
  6: 'Falha ao inicializar TCP/IP',
  7: 'Memória insuficiente',
  8: 'CliSiTef indisponível ou com problemas',
  9: 'Quantidade de servidores configurados excedida',
  10: 'Acesso à pasta da CliSiTef negado',
  11: 'Dados fornecidos pela automação inválidos',
  12: 'Modo seguro inativo',
  13: 'Caminho das bibliotecas inválido ou longo demais',
});

export const TRANSACTION_RETURNS: Readonly<Record<number, string>> = Object.freeze({
  0: 'Função concluída com sucesso',
  10000: 'Continuar o processo iterativo',
  [-1]: 'Biblioteca ainda não configurada',
  [-2]: 'Cancelado pelo operador',
  [-3]: 'Função ou modalidade inválida',
  [-4]: 'Memória insuficiente no PDV',
  [-5]: 'Sem comunicação com o SiTef',
  [-6]: 'Cancelado pelo usuário no pinpad',
  [-7]: 'Código reservado pelo fornecedor',
  [-8]: 'Implementação da função ausente na versão instalada',
  [-9]: 'Continuação chamada sem iniciar uma função iterativa',
  [-10]: 'Parâmetro obrigatório ausente',
  [-12]: 'Processo iterativo anterior não encerrado ou execução iterativa inválida',
  [-13]: 'Documento fiscal não encontrado',
  [-15]: 'Cancelado pela automação',
  [-20]: 'Parâmetro inválido',
  [-21]: 'Termo proibido na coleta de dados abertos pelo pinpad',
  [-22]: 'Carteira digital não habilitada',
  [-23]: 'Carteira digital sem transação habilitada',
  [-25]: 'Correspondente bancário requer sangria',
  [-30]: 'Erro de acesso a arquivo',
  [-40]: 'Transação recusada pelo servidor SiTef',
  [-41]: 'Dados inválidos',
  [-42]: 'Código reservado pelo fornecedor',
  [-43]: 'Falha em uma rotina do pinpad',
  [-50]: 'Transação sem segurança requerida',
  [-100]: 'Falha interna da biblioteca',
});

export const SECURE_READ_RETURNS: Readonly<Record<number, string>> = Object.freeze({
  0: 'Leitura concluída',
  1: 'Área de saída insuficiente',
  2: 'BIN não habilitado',
  3: 'CNPJ inválido',
  4: 'Chave de acesso vencida',
  5: 'Versão inválida',
  6: 'Chave de criptografia inválida',
  7: 'Dados incompatíveis com a chave de criptografia',
  8: 'Dado de entrada inválido',
  12: 'Modo seguro inativo para captura de cartão',
});

export type ReturnContext = 'configuration' | 'transaction' | 'secure-transaction' | 'pending-count' |
  'pinpad-presence' | 'pinpad-confirmation' | 'pinpad-key' | 'barcode-validation' |
  'secure-read' | 'zero-status';
export type ReturnKind = 'success' | 'continue' | 'authorizer-declined' | 'error' |
  'cancelled' | 'reserved' | 'count' | 'present' | 'absent' | 'confirmed' |
  'key' | 'invalid-data' | 'unknown';
export interface ReturnInfo {
  code: number;
  known: boolean;
  kind: ReturnKind;
  message: string;
}

/** Interpret codes in the function's own domain; +1 is not always a denial. */
export function classifyReturn(code: number, context: ReturnContext = 'transaction'): ReturnInfo {
  if (!Number.isInteger(code)) throw new TypeError('O retorno nativo deve ser inteiro.');
  const result = (kind: ReturnKind, message: string, known = true): ReturnInfo => ({ code, known, kind, message });
  if (context === 'configuration') {
    return result(code === 0 ? 'success' : 'error', CONFIGURATION_RETURNS[code] ?? `Retorno de configuração não catalogado (${code})`, code in CONFIGURATION_RETURNS);
  }
  if (context === 'pending-count') {
    if (code >= 0) return result('count', `${code} transações pendentes`);
    return result('error', TRANSACTION_RETURNS[code] ?? `Falha na consulta de pendências (${code})`, code in TRANSACTION_RETURNS);
  }
  if (context === 'pinpad-presence') {
    if (code === 1) return result('present', 'Pinpad operacional');
    if (code === 0) return result('absent', 'Nenhum pinpad operacional');
    return result('error', code === -1 ? 'Biblioteca de acesso ao pinpad ausente' : `Falha ao consultar pinpad (${code})`, code === -1);
  }
  if (context === 'pinpad-confirmation') {
    if (code === 1) return result('confirmed', 'Confirmação no pinpad');
    if (code === 0) return result('cancelled', 'Cancelamento no pinpad');
    return result('error', `Falha na confirmação do pinpad (${code})`, false);
  }
  if (context === 'pinpad-key') {
    const keys: Readonly<Record<number, string>> = { 0: 'OK/ENTER', 4: 'F1', 5: 'F2', 6: 'F3', 7: 'F4', 8: 'LIMPA', 13: 'CANCELA' };
    return code in keys ? result('key', keys[code]!) : result('error', TRANSACTION_RETURNS[code] ?? `Falha na leitura de tecla (${code})`, code === -43);
  }
  if (context === 'barcode-validation') {
    if (code === 0) return result('success', 'Código válido até o ponto informado');
    if (code === -1) return result('invalid-data', 'Código de barras não reconhecido');
    if (code >= 1 && code <= 4) return result('invalid-data', `Bloco ${code} inválido`);
    if (code === 5) return result('invalid-data', 'Código completo inválido');
    return result('error', `Retorno de validação não catalogado (${code})`, false);
  }
  if (context === 'secure-read') return result(code === 0 ? 'success' : 'error', SECURE_READ_RETURNS[code] ?? `Falha na leitura segura (${code})`, code in SECURE_READ_RETURNS);
  if (context === 'zero-status') return result(code === 0 ? 'success' : 'error', code === 0 ? 'Função concluída' : `Falha da função nativa (${code})`, code === 0);
  if (context === 'secure-transaction' && code === 12) return result('error', SECURE_READ_RETURNS[12]!);
  if (code === 0) return result('success', TRANSACTION_RETURNS[0]!);
  if (code === 10000) return result('continue', TRANSACTION_RETURNS[10000]!);
  if (code > 0) return result('authorizer-declined', `Recusa do autorizador (${code})`, false);
  const kind = [-2, -6, -15].includes(code) ? 'cancelled' : [-7, -42].includes(code) ? 'reserved' : 'error';
  return result(kind, TRANSACTION_RETURNS[code] ?? `Falha interna não catalogada (${code})`, code in TRANSACTION_RETURNS);
}
export const describeReturn = classifyReturn;

export const CONTINUATION = Object.freeze({ CANCEL: -1, NEXT: 0, BACK: 1, CANCEL_CURRENT_BILL: 2, PRECOLLECTED_CONFIRMED: 10000 } as const);

export type CommandKind = 'field' | 'display' | 'clear' | 'menu-title' | 'clear-menu-title' |
  'header' | 'clear-header' | 'confirmation' | 'menu' | 'acknowledge' | 'poll' |
  'system-input' | 'input' | 'cheque' | 'amount' | 'barcode' | 'masked-input' |
  'identified-menu' | 'show-qr' | 'hide-qr' | 'qr-footer' | 'unknown';
export interface CommandInfo { kind: CommandKind; blocking: boolean; description: string; }
export const COMMANDS: Readonly<Record<number, CommandInfo>> = Object.freeze({
  0: { kind: 'field', blocking: false, description: 'Receber dado ou evento sem alterar o buffer nativo' },
  1: { kind: 'display', blocking: false, description: 'Mensagem ao operador' },
  2: { kind: 'display', blocking: false, description: 'Mensagem ao cliente' },
  3: { kind: 'display', blocking: false, description: 'Mensagem ao operador e ao cliente' },
  4: { kind: 'menu-title', blocking: false, description: 'Definir título do menu' },
  11: { kind: 'clear', blocking: false, description: 'Limpar mensagem do operador' },
  12: { kind: 'clear', blocking: false, description: 'Limpar mensagem do cliente' },
  13: { kind: 'clear', blocking: false, description: 'Limpar mensagens dos dois visores' },
  14: { kind: 'clear-menu-title', blocking: false, description: 'Limpar título do menu' },
  15: { kind: 'header', blocking: false, description: 'Exibir cabeçalho adicional' },
  16: { kind: 'clear-header', blocking: false, description: 'Limpar cabeçalho' },
  20: { kind: 'confirmation', blocking: true, description: 'SIM/NÃO: devolver 0 confirma ou 1 cancela no buffer' },
  21: { kind: 'menu', blocking: true, description: 'Menu índice:texto; devolver índice escolhido' },
  22: { kind: 'acknowledge', blocking: true, description: 'Exibir mensagem e aguardar tecla' },
  23: { kind: 'poll', blocking: false, description: 'Verificar cancelamento de espera do periférico, sem atraso artificial' },
  29: { kind: 'system-input', blocking: true, description: 'Coletar dado da aplicação sem intervenção do operador' },
  30: { kind: 'input', blocking: true, description: 'Coletar campo respeitando tamanhos mínimo e máximo' },
  31: { kind: 'cheque', blocking: true, description: 'Cheque: 0: primeira linha; 1: CMC7 lido; 2: CMC7 digitado' },
  34: { kind: 'amount', blocking: true, description: 'Coletar valor decimal como texto, sem ponto flutuante binário' },
  35: { kind: 'barcode', blocking: true, description: 'Código: 0: digitado; 1: lido; 2: cancela coleta atual preservando anteriores' },
  41: { kind: 'masked-input', blocking: true, description: 'Coletar campo mascarado' },
  42: { kind: 'identified-menu', blocking: true, description: 'Menu classe|índice:texto:código:tipo; devolver índice' },
  50: { kind: 'show-qr', blocking: false, description: 'Exibir QR do campo 584 e continuar imediatamente o loop' },
  51: { kind: 'hide-qr', blocking: false, description: 'Remover QR anteriormente exibido' },
  52: { kind: 'qr-footer', blocking: false, description: 'Atualizar rodapé opcional do QR (campo 4128)' },
});
export type DocumentedCommandCode = keyof typeof COMMANDS;
export function getCommandInfo(code: number): CommandInfo {
  return COMMANDS[code] ?? { kind: 'unknown', blocking: true, description: `Comando não catalogado (${code}); exige tratamento explícito` };
}

/** Friendly aliases only. The native field type remains an unrestricted number. */
export const FIELD_IDS = Object.freeze({
  NO_DATA: -1, AUTHORIZATION_START: 0, CONFIRMATION_DATA: 1, SITEF_FUNCTION: 2,
  PAYMENT_MODE: 100, PAYMENT_MODE_TEXT: 101, FISCAL_PAYMENT_TEXT: 102,
  HOST_DATETIME: 105, WALLET_ID: 106, WALLET_NAME: 107, WALLET_CARD_BRAND: 108,
  APPROVED_AMOUNT: 109, CLIENT_RECEIPT: 121, MERCHANT_RECEIPT: 122, RECEIPT_TYPE: 123,
  ACQUIRER_ID: 131, CARD_BRAND_ID: 132, SITEF_NSU: 133, HOST_NSU: 134, AUTHORIZATION_CODE: 135,
  BIN: 136, MERCHANT_CODE: 157, AUTHORIZER_NETWORK: 158,
  FISCAL_DOCUMENT: 160, PAYMENT_INDEX: 161, FISCAL_DATE: 163, FISCAL_TIME: 164,
  PENDING_COUNT: 210, ORIGINAL_FUNCTION: 211, DOCUMENT: 502, COMPANY_DOCUMENT: 503,
  INSTALLMENTS: 505, CHEQUE: 517, PHONE: 522, WALLET_PRODUCT_TYPE: 545,
  WALLET_VOUCHER_TYPE: 546, MERCHANT_QR: 584, CLIENT_TOKEN: 585,
  BILL_INDEX: 607, PAID_BARCODE: 624, MAX_PAYMENT_METHODS: 730, PAYMENT_METHOD: 731,
  PAYMENT_DATA: 732, CLIENT_QR: 740, FACE_BIOMETRICS: 742, EXTERNAL_AUTHORIZATION: 743,
  NFC_E_ACQUIRER_TAX_ID: 950, NFC_E_BRAND: 951, NFC_E_AUTHORIZATION: 952,
  PRODUCT_LIST_FUEL: 1115, ORIGINAL_AMOUNT: 1319, PRODUCT_LIST: 1323,
  FORMAT_HINT: 2355, DECIMAL_PLACES: 2470, PINPAD_MESSAGE: 2601, HASH_SEED: 2602,
  CARD_READ_MODE: 2603, COMMUNICATION_ERROR: 4100, QR_FOOTER: 4128,
  PIX_PSP: 4153, PIX_PAYER_REQUEST: 4154, PIX_PAYER_RESPONSE: 4155,
  PIX_ADDITIONAL_FIELDS: 4156, PIX_PRODUCT_INFORMATION: 4157,
} as const);

/** Field ranges with documented semantics; not an exhaustive field whitelist. */
export const FIELD_RANGES = Object.freeze([
  { from: 10, to: 99, kind: 'menu-selection' },
  { from: 800, to: 849, kind: 'gerpdv-reserved' },
  { from: 2021, to: 2026, kind: 'masked-card-data' },
  { from: 2031, to: 2036, kind: 'salted-card-hash' },
  { from: 2041, to: 2046, kind: 'encrypted-card-data' },
  { from: 2051, to: 2056, kind: 'legacy-card-hash' },
  { from: 3000, to: 3999, kind: 'menu-selection' },
] as const);

/** Events are numeric field types, never commands or terminal transaction status. */
export const EVENTS: Readonly<Record<number, string>> = Object.freeze({
  5000: 'Aguardando leitura de cartão', 5001: 'Aguardando senha',
  5002: 'Aguardando confirmação positiva', 5003: 'Aguardando bilhete único',
  5004: 'Aguardando retirada do bilhete único', 5005: 'Evento de finalização da transação',
  5006: 'Confirmar dados do favorecido', 5007: 'Conectado ao SiTef', 5008: 'Conectando ao SiTef',
  5009: 'Consulta concluída', 5010: 'Coletar assinatura', 5011: 'Coletar novo produto',
  5012: 'Confirmar operação', 5013: 'Confirmar cancelamento', 5014: 'Confirmar valor total',
  5015: 'Recarga do bilhete único concluída', 5016: 'Reservado',
  5017: 'Aguardando leitura de cartão', 5018: 'Aguardando senha no pinpad',
  5019: 'Processando chip', 5020: 'Aguardando retirada do cartão', 5021: 'Aguardando confirmação',
  5027: 'Leitura de cartão cancelada', 5028: 'Digitação da senha cancelada',
  5029: 'Processamento de chip cancelado', 5030: 'Retirada de cartão cancelada',
  5031: 'Confirmação cancelada', 5036: 'Antes da leitura de cartão magnético',
  5037: 'Antes da leitura do chip', 5038: 'Antes da retirada do chip',
  5039: 'Antes da coleta da senha', 5040: 'Antes de abrir comunicação com pinpad',
  5041: 'Antes de fechar comunicação com pinpad', 5042: 'Bloquear recursos do pinpad',
  5043: 'Liberar recursos do pinpad', 5044: 'Comunicação com pinpad aberta',
  5049: 'Timeout do SiTef', 5050: 'Atualizando tabelas offline', 5051: 'Senha coletada no pinpad',
  5052: 'Chip processado', 5053: 'Cartão com chip retirado', 5054: 'Dados sensíveis entregues (PAX)',
  5055: 'Registro de tabela enviado ao pinpad', 5056: 'Enviando arquivos ao SiTef',
  5057: 'Início de campos sensíveis', 5058: 'Fim de campos sensíveis',
  5059: 'Aguardando leitura de cartão (modalidade 29)', 5060: 'Reservado', 5061: 'Reservado',
  5062: 'Início de campos de produto', 5063: 'Fim de campos de produto',
  5064: 'Início de campos de recarga TEF', 5065: 'Fim de campos de recarga TEF',
  5066: 'Antes de conectar ao SiTef', 5067: 'Depois de conectar ao SiTef',
  5068: 'Antes de desconectar do SiTef', 5069: 'Depois de desconectar do SiTef',
  5070: 'Antes de enviar ao SiTef', 5071: 'Depois de enviar ao SiTef',
  5072: 'Antes de receber do SiTef', 5073: 'Depois de receber do SiTef',
  5074: 'Assinatura em papel exigida', 5084: 'Mensagem do SiTef ou autorizador',
  5501: 'Início de correspondente bancário',
});

/** Cataloged transaction function IDs; start() also accepts all other integers. */
export const FUNCTION_CODES: Readonly<Record<number, string>> = Object.freeze({
  0: 'Pagamento genérico', 1: 'Cheque', 2: 'Débito', 3: 'Crédito', 4: 'Fininvest',
  5: 'Benefício', 6: 'Crédito centralizado', 7: 'Combustível', 8: 'Parcele Mais Redecard',
  10: 'Refeição Wappa', 11: 'Alimentação Wappa', 12: 'Infocard', 13: 'Pay Pass',
  15: 'Gift venda', 16: 'Débito carnê', 17: 'Crédito carnê', 28: 'ICI Card venda',
  100: 'Telemarketing', 101: 'ICI Card cancelamento', 110: 'Menu gerencial',
  111: 'Teste de comunicação', 112: 'Menu reimpressão', 113: 'Reimpressão específica',
  114: 'Reimpressão última', 115: 'Pré-autorização', 116: 'Captura pré-autorização',
  117: 'Ajuste pré-autorização', 118: 'Consulta pré-autorização',
  122: 'Carteira digital venda', 123: 'Carteira digital cancelamento',
  124: 'Carteira digital saque', 125: 'Carteira digital recarga',
  126: 'Carteira digital cancelamento recarga', 127: 'Carteira digital saldo',
  129: 'Carteira digital cancelamento saque',
  130: 'Pendências do terminal', 131: 'Pendências do documento fiscal',
  150: 'Consulta bônus', 151: 'Saldo cartão presente', 152: 'Saldo gift',
  160: 'Consulta EMS', 161: 'Venda EMS', 200: 'Cancelamento', 201: 'Cancelamento telemarketing',
  202: 'Cancelamento pré-autorização', 203: 'Cancelamento captura pré-autorização',
  210: 'Cancelamento crédito', 211: 'Cancelamento débito', 212: 'Cancelamento combustível',
  213: 'Cancelamento gift', 250: 'Cancelamento consulta bônus', 251: 'Cancelamento recarga presente',
  253: 'Cancelamento acúmulo bônus', 254: 'Resgate bônus', 255: 'Cancelamento resgate bônus',
  256: 'Acúmulo bônus', 257: 'Cancelamento recarga gift', 264: 'Recarga gift',
  265: 'Ativação gift com pagamento vinculado', 266: 'Consulta gift',
  267: 'Ativação gift sem pagamento', 268: 'Ativação gift com pagamento', 269: 'Ativação gift desvinculada',
  310: 'Pagamento de contas', 311: 'Pagamento de contas com saque', 312: 'Consulta desvinculada',
  313: 'Pagamento desvinculado', 314: 'Recarga Corban SE com saque', 315: 'Saque para pagamento',
  316: 'Cancelamento pagamento desvinculado', 317: 'Limites correspondente',
  318: 'Recarga Bradesco', 319: 'Recarga Bradesco desvinculada', 320: 'Recarga Corban SE',
  321: 'Recarga Corban SE desvinculada', 322: 'Depósito identificado', 323: 'Transferência',
  324: 'Pague Fácil', 325: 'Revalidação senha INSS', 330: 'Compre e saque',
  350: 'Venda produto sem valor', 351: 'Cancelamento produto sem valor',
  400: 'Vale gás', 401: 'Validação vale gás', 410: 'Troco surpresa', 422: 'Adesão seguro',
  430: 'Leitura segura de cartão', 431: 'Leitura chip interativa',
  500: 'Consulta ACSP', 501: 'Consulta Serasa', 600: 'Consulta saldo', 601: 'Saldo débito',
  602: 'Saldo crédito', 625: 'Voucher com coleta', 626: 'Fornecedores e produtos',
  627: 'Voucher sem coleta', 628: 'Cancelamento voucher', 657: 'Saque crédito transferência',
  658: 'Saque crédito', 660: 'Menu saque IBI', 661: 'Consulta saque IBI', 662: 'Saque IBI',
  663: 'Saque GetNet', 664: 'Cancelamento saque GetNet', 665: 'Resgate pontos',
  667: 'Emissão pontos', 668: 'Cancelamento emissão pontos', 669: 'Carga pré-pago',
  670: 'Cancelamento carga pré-pago', 671: 'Consulta saque IBI com saque',
  672: 'Cancelamento saque IBI', 680: 'Saldo pré-pago', 698: 'Saque débito',
  700: 'Oi Paggo venda', 701: 'Oi Paggo cancelamento', 702: 'Pagamento de contas',
  703: 'Cancelamento pagamento benefício', 705: 'Pagamento fatura',
  740: 'Consulta parcelas crédito administradora', 770: 'Carga tabelas pinpad',
  771: 'Carga forçada local', 772: 'Carga forçada SiTef', 775: 'Informações pinpad',
  899: 'Recarga crédito', 900: 'Cancelamento recarga crédito', 913: 'Alteração pré-autorização',
  928: 'Cancelamento débito carnê rede forçada', 943: 'Pagamento de fatura sem fatura vinculado',
  944: 'Pagamento de fatura sem fatura desvinculado', 999: 'Fechamento', 1000: 'Voucher papel',
});

/** Names found in the supplied documents. Raw strings stay available for every extension. */
export const DOCUMENTED_ADDITIONAL_PARAMETERS = Object.freeze({
  configuration: ['MultiplosCupons', 'PortaPinPad', 'LojaECF', 'CaixaECF', 'NumeroSerieECF', 'ParmsClient', 'TrataPontoFlutuante'],
  transaction: [
    'CodigoCliente', 'ExecutaAteLeituraCartao', 'HabilitaVendaViaCodigoBarras',
    'ItemMenuIdentificado', 'MKRede', 'MKRedeDados', 'NumCartaoCripto', 'RedeDestino',
    'TrataConsultaSaqueComSaque', 'TrataPagamentoExtendido', 'ValidadeCartao',
    'ValorIncluiTaxa', 'TipoDocFiscal', 'ChaveAcessoDocFiscal', 'CPFColetado',
    'SPLITPAY', 'SementeHash', 'PortaPinPadCB', 'AdiaRemocaoCartao', 'ListaVouchersNaoAceitos',
    'DevolveStringQRCode', 'RestricoesCarteirasDigitais', 'CarteirasDigitaisHabilitadas',
    'CarteirasDigitaisPriorizadasMenuFixo',
  ],
  finalization: ['NumeroPagamentoCupom', 'RedeConfirmacao', 'NumeroPagamentoNFPAG', 'NFPAG'],
} as const);

/** INI names are hints, not a validation list. Use the application-supplied INI unchanged. */
export const DOCUMENTED_INI_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  PinPadCompartilhado: ['Porta'],
  PinPad: ['MensagemPadrao'],
  SiTef: ['EnderecoIP', 'PortaSiTef', 'ConexaoObrigatoria', 'MantemConexaoAtiva',
    'TempoEsperaConexao', 'TempoAdicionalEspera', 'TempoEsperaDesfazimento', 'TempoEsperaConfirmacao'],
  Geral: ['ConfirmarValorPinPad', 'MostradorComunicacaoHabilitado', 'PermiteAlterarValorPagamento',
    'TransacoesHabilitadas', 'TransacoesAdicionaisHabilitadas', 'TransacoesDesabilitadas',
    'DevolveConfirmacaoExtendida', 'PermiteDevolucaoCodigoAutorizacaoEstendido',
    'ModalidadesPermitePagVinculadoCredParcAdm', 'ModalidadesPermitePagVinculadoCredParcLoja',
    'NumeroDeDiasNoLog', 'DataEmAmbienteDeDesenvolvimento', 'EmAmbienteDeHomologacao'],
  Redes: ['HabilitaRede<nome>'],
  CarteirasDigitais: ['Restricoes', 'CarteirasHabilitadas', 'PriorizaListaFixa', 'HabilitaLeituraQRCode'],
  CartaoCombustivel: ['ColetaDadosProdutoSeparadamente', 'Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>', 'HabilitaCodBar<N>'],
  Debito: ['Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>'],
  Credito: ['Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>', 'TransacoesAdicionais<N>'],
  CartaoGift: ['Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>', 'HabilitaCodBar<N>', 'HabilitaCodUnitarioGift<N>', 'HabilitaEgiftDigitadoGift<N>'],
  SaqueCredito: ['Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>'],
  SaqueDebito: ['Texto<N>', 'Rede<N>', 'HabilitaDigitado<N>', 'HabilitaMagnetico<N>'],
  SalvaEstado: ['DiretorioBase'],
  CliSiTef: ['DiretorioTrace', 'TracePorTerminal', 'TracePorHora', 'TraceRotativo', 'TamanhoTraceRotativo'],
  TabTraducao: ['NomeArqTraducao', 'MsgNovoValor', 'MsgEmbosso', 'MsgCodigoSeguranca', '<identificador de mensagem>'],
});
