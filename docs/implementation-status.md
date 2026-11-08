# Estado da implementação 0.2

A base semântica usa os PDFs do kit x86 VRS-258 e Carteiras Digitais 1.43.
Os 444 IDs da seção 5.3.2 foram conferidos com VRS-260, e os guias
registram consultas pontuais a essa revisão, sem auditoria semântica completa.
Runtime Windows x64. Nenhum PDF, DLL, INI ou chave acompanha os projetos.

| Obrigação | Implementação e verificação |
| --- | --- |
| Retornos 5.2.1 | Todos os enumerados e regras gerais por domínio; desconhecidos preservados |
| Funções 5.2.2 | 124 base + sete carteiras; política conhecida não pode ser invertida |
| TipoCampo 5.3.2 | Todos os 444 individuais, faixas/contextos; 536 entradas com eventos/extensões; extração independente com zero IDs ausentes |
| Formatos | 2355, 2470, 1121/1126, datas, menus Mc, bytes nativos e valores exatos |
| Impressão | Armazenamento externo, impressão imediata/adiada, recuperação por hash |
| Assinatura/recursos | 5074 após impressão; 5042/5043 com cleanup também em falhas |
| Produtos | PBM, limites e fallback exigem validação externa quando necessária |
| Contas | Agrupamento por índice, impressão imediata e cancelamento parcial contextual |
| Múltiplos pagamentos | Estado V2 acumulado, nova transação sem append obrigatório, partições por cupom/data; persistência opcional |
| Seleção | Índice 161/rede resolvida; recovery não alcança pagamentos irmãos |
| NFPAG | Requisitos 730/731/732, soma exata, origem de cheque, redes, payload externo por hash |
| Pendências | 130/131 em recuperação sem escrever no journal financeiro |
| Migração V1 | Confirmação exige atestado das obrigações não registradas no formato antigo |
| Modal | cosmemilton-ui obrigatório, coleta semântica e confirmação adicional Mc |

Os testes usam transportes controlados e uma biblioteca C original através da
ponte Rust. Com a DLL simulada x64 foram verificados carregamento, capacidades,
versão e configuração; nenhuma transação financeira foi homologada.

A aplicação implementa hardware, armazenamento, assinatura e suas regras de produto.
A API anterior exige os hooks conforme sua política SDK. A fachada `ClientSitef`
usa responsabilidade automation e retorno explícito por padrão, preservando
as obrigações da aplicação e as guardas objetivas. Não fabrica impressão,
assinatura ou decisão comercial. Veja [cliente e transações](client-transactions.md).
Permanecem condicionadas ao fornecedor as rotinas diretas com callback cuja ABI é
ambígua no PDF, manuais adicionais de produtos e o kit Linux. Há alternativas de
leitura pelo laço interativo. Veja [a matriz nativa](protocol-coverage.md) e
[o contrato semântico](semantic-flows.md).
