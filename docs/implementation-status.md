# Estado da implementação 0.2

A referência usa exclusivamente os PDFs do kit x86: VRS-258 e Carteiras Digitais
1.43. Runtime Windows x64. Nenhum PDF, DLL, INI ou chave acompanha os projetos.

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
| Múltiplos pagamentos | Journal V2, append explícito, partições por cupom/data e plano durável |
| Seleção | Índice 161/rede resolvida; recovery não alcança pagamentos irmãos |
| NFPAG | Requisitos 730/731/732, soma exata, origem de cheque, redes, payload externo por hash |
| Pendências | 130/131 em recuperação sem escrever no journal financeiro |
| Migração V1 | Confirmação exige atestado das obrigações não registradas no formato antigo |
| Modal | cosmemilton-ui obrigatório, coleta semântica e confirmação adicional Mc |

Os testes usam transportes controlados e uma biblioteca C original através da
ponte Rust. Com a DLL simulada x64 foram verificados carregamento, capacidades,
versão e configuração; nenhuma transação financeira foi homologada.

A aplicação implementa hardware, armazenamento, assinatura e suas regras de produto.
O SDK exige o cumprimento dos hooks; não fabrica uma impressão ou decisão comercial.
Permanecem condicionadas ao fornecedor as rotinas diretas com callback cuja ABI é
ambígua no PDF, manuais adicionais de produtos e o kit Linux. Há alternativas de
leitura pelo laço interativo. Veja [a matriz nativa](protocol-coverage.md) e
[o contrato semântico](semantic-flows.md).
