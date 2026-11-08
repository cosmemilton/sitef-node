# Validação e limites

## Registro histórico da versão 0.2

Os resultados abaixo registram verificações anteriores. Não são uma reexecução da versão 0.3.0 nem evidência de publicação. A preparação de cada release deve repetir os comandos do README e registrar separadamente as etapas aprovadas, falhas e não executadas.

- Node 24.15.0 em WSL: compilação core/UI, 64/64 testes core e 20/20 modal, sem skips.
- Node 24.18.0 em Windows x64: 64/64 testes core, sem skips.
- Rust: 10/10 testes unitários; fixtures C originais via stdio e TCP autenticado.
- Integração Node, Rust e fixture C aprovada em Linux de teste e Windows x64.
- Exemplo sintético em memória aprovado.
- Modal real com cosmemilton-ui inspecionado em claro/escuro/celular: Mc em duas
  etapas, troca de opção, cancelamento parcial, campos sensíveis e toast sem deslocar
  o diálogo; nenhuma falha de página observada.
- Catálogo auditado contra extração independente dos PDFs x86: 444 campos-base,
  64 eventos, 28 extras, 131 funções, zero IDs ausentes nas tabelas consultadas.

Os cenários incluem obrigações de produto, precisão e formatos, Base64/texto,
recuperação de recibos/assinatura, múltiplos pagamentos e virada de data, seleção de
pagamento/rede, NFPAG externo, decisões duráveis, falha parcial e perda de gravação
após retorno local da finalização. A finalização void não é confirmação remota.

As bibliotecas C são código próprio de teste, sem dados, código ou comportamento
financeiro do fabricante. Não houve pagamento real, pinpad físico, impressão física
ou homologação financeira nestes testes. O smoke anterior da DLL simulada x64
limitou-se a carregamento, capacidades, versão e configuração.
## Release 0.3.0: validação local em 2026-11-08

- Windows x64: 436 testes aprovados (423 core/CLI e 13 de empacotamento), sem falhas ou skips.
- WSL: 395 testes core aprovados; 28 exclusivos de Windows ignorados. UI: 20 aprovados. Empacotamento: 13 aprovados.
- Rust: 10 testes aprovados. Smoke ABI/IPC, handshake TCP autenticado com fixture própria e integração SDK/Rust/C aprovados.
- Os dois pacotes passaram por `npm pack --dry-run`. Tarballs reais também foram inspecionados e importados em consumidor temporário isolado: core, core/fields e UI/controller. Declarações públicas passaram pelo TypeScript estrito NodeNext.
- Foram verificados os tipos de arquivo, ausência de sourcemaps pessoais, binários proprietários, certificados, INIs, registros operacionais e fixtures nos tarballs.

Esta rodada não carregou a DLL do fornecedor nem realizou operações financeiras. GitHub Actions permanece um template inativo; npm não foi publicado. Estes resultados não equivalem à homologação SiTef.

## Candidatos MIT 0.3.0: verificação adicional em 2026-11-08

- LICENSE MIT canônico conferido na raiz e em ambos os tarballs; os artefatos incluem somente código/dados próprios, manifest, README e licença.
- Windows x64: 438 testes aprovados (423 core/CLI e 15 de empacotamento), sem falhas ou skips. WSL: 395 core aprovados e 28 testes exclusivos de Windows ignorados; UI 20/20 e empacotamento 15/15.
- Rust 10/10, smoke ABI/IPC, TCP autenticado e integração SDK/Rust/C aprovados usando somente fixtures próprias.
- Ponte Windows x64 recompilada com sucesso. Os avisos LNK4099 dizem respeito a PDBs de depuração das bibliotecas Microsoft; nenhum binário do fornecedor foi carregado.
- Os dois tarballs foram instalados de fato com npm em um projeto temporário vazio, com scripts de instalação desabilitados e dependências peer resolvidas pelo registro público.
- Imports do core, ClientSitef, fields, UI/controller e entrypoint React principal aprovados. Declarações passaram por TypeScript NodeNext estrito, sem skipLibCheck; o modal com providers e CSS gerou bundle de navegador.
- O core instalado por tarball também passou pela integração ClientSitef, processo Rust e fixture C própria, incluindo inicialização única, campos e decisões locais sintéticas.

Esta rodada não executou pagamentos, não usou pinpad ou DLL proprietária e não constitui homologação. Instalação de tarballs não comprova publicação no registro; autenticação e envio npm continuam sendo etapas separadas.
