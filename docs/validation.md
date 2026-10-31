# Validação da versão 0.2

- Node24.15.0 em WSL: compilação core/UI, 64/64 testes core e20/20 modal, sem skips.
- Node24.18.0 em Windows x64: 64/64 testes core, sem skips.
- Rust:10/10 testes unitários; fixtures C originais via stdio e TCP autenticado.
- Integração Node→Rust→fixture C aprovada em Linux de teste e Windows x64.
- Exemplo sintético em memória aprovado.
- Modal real com cosmemilton-ui inspecionado em claro/escuro/celular: Mc em duas
  etapas, troca de opção, cancelamento parcial, campos sensíveis e toast sem deslocar
  o diálogo; nenhuma falha de página observada.
- Catálogo auditado contra extração independente dos PDFs x86:444 campos-base,
  64 eventos,28 extras,131 funções, zero IDs ausentes nas tabelas consultadas.

Os cenários incluem obrigações de produto, precisão e formatos, Base64/texto,
recuperação de recibos/assinatura, múltiplos pagamentos e virada de data, seleção de
pagamento/rede, NFPAG externo, decisões duráveis, falha parcial e perda de gravação
após retorno local da finalização. A finalização void não é confirmação remota.

As bibliotecas C são código próprio de teste, sem dados, código ou comportamento
financeiro do fabricante. Não houve pagamento real, pinpad físico, impressão física
ou homologação financeira nestes testes. O smoke anterior da DLL simulada x64
limitou-se a carregamento, capacidades, versão e configuração.
