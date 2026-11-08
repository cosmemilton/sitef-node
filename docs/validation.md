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

Esta rodada não carregou a DLL do fornecedor nem realizou operações financeiras. GitHub Actions permaneceu um template inativo; naquela etapa, npm ainda não havia sido publicado. Estes resultados não equivalem à homologação SiTef.

## Candidatos MIT 0.3.0: verificação adicional em 2026-11-08

- LICENSE MIT canônico conferido na raiz e em ambos os tarballs; os artefatos incluem somente código/dados próprios, manifest, README e licença.
- Windows x64: 438 testes aprovados (423 core/CLI e 15 de empacotamento), sem falhas ou skips. WSL: 395 core aprovados e 28 testes exclusivos de Windows ignorados; UI 20/20 e empacotamento 15/15.
- Rust 10/10, smoke ABI/IPC, TCP autenticado e integração SDK/Rust/C aprovados usando somente fixtures próprias.
- Ponte Windows x64 recompilada com sucesso. Os avisos LNK4099 dizem respeito a PDBs de depuração das bibliotecas Microsoft; nenhum binário do fornecedor foi carregado.
- Os dois tarballs foram instalados de fato com npm em um projeto temporário vazio, com scripts de instalação desabilitados e dependências peer resolvidas pelo registro público.
- Imports do core, ClientSitef, fields, UI/controller e entrypoint React principal aprovados. Declarações passaram por TypeScript NodeNext estrito, sem skipLibCheck; o modal com providers e CSS gerou bundle de navegador.
- O core instalado por tarball também passou pela integração ClientSitef, processo Rust e fixture C própria, incluindo inicialização única, campos e decisões locais sintéticas.

Esta rodada não executou pagamentos, não usou pinpad ou DLL proprietária e não constitui homologação. Naquela etapa, a instalação de tarballs não comprovava publicação no registro; autenticação e envio npm eram etapas posteriores.

## Publicação npm 0.3.0 em 2026-11-08

Os dois pacotes foram publicados com acesso público e licença MIT, a partir do
commit `5933843af06ca5ec3becef60ced5112514b2416b`. O registro foi consultado,
`latest=0.3.0` confirmado para ambos e os tarballs foram baixados anonimamente,
com SHA-1 e SHA-512 conferidos. Links e hashes estão em [releases npm](releasing.md#release-030-publicada-em-2026-11-08).

A instalação pelo nome e versão diretamente do registro também passou em projeto
vazio, com cache novo, sem autenticação e sem scripts de instalação. Os imports
do core, ClientSitef, fields, UI/controller e entrypoint React principal funcionaram;
as integridades dos dois pacotes foram conferidas no lockfile do consumidor.

Essa verificação de distribuição não é homologação, execução de pagamentos
nem evidência de execução de CI.

## Preparação dos bridges 0.4.0 em 2026-11-08

Esta seção é uma nova rodada local, não modifica os resultados históricos da
0.3.0 e não comprova publicação npm ou execução remota de CI.

- Rust: 12 testes unitários aprovados no host Linux x64 e 12 no alvo Linux i686.
- Smoke ABI/IPC com fixtures próprias aprovado no host e em i686; no alvo i686
  a fixture ELF32 usa a guarda real, com testMode false.
- O bridge Linux de release usa interpreter padrão /lib/ld-linux.so.2, requer
  glibc >=2.34 e libgcc_s.so.1/libc.so.6, sem RPATH/RUNPATH do laboratório.
  O host WSL não possui loader i386 instalado globalmente; a execução local
  usou o loader/sysroot isolado já existente, sem instalação global.
- Kit Linux32 fornecido, versão 7.0.117.126S: carga, configuração e consulta de
  versão aprovadas com testMode false; configure e version retornaram status 0.
  Capacidades reportaram linux/x86/linux-ia32 e fieldTypeBytes=4.
- O kit e suas dependências permanecem externos aos pacotes. Essa verificação
  não executou pagamentos, não conectou USB, não testou pinpad e não homologa
  cancelamento, impressão ou reconciliação financeira.

Verificação final agregada desta preparação:

- npm run check aprovado: core 404 testes aprovados e 28 exclusivos de Windows
  ignorados no host Linux; UI 20 aprovados; empacotamento 21 aprovados.
- Integração Node/Rust/C com fixture própria aprovada; pack:check do core e UI
  aprovado.
- Consumidor temporário novo, instalado offline a partir dos tarballs: resolução
  automática do pacote compatível e exclusão da plataforma estrangeira aprovadas.
- Ambos os bridges foram recompilados com remapeamento de caminhos pessoais.
  Os guards de distribuição rejeitam caminhos pessoais incorporados; no Linux,
  exigem PT_INTERP padrão e ausência de RPATH/RUNPATH.
- O novo bridge Windows x64 remapeado carregou, configurou e consultou a versão
  do kit fornecido 7.0.117.123S.r2, com status 0. A verificação usou runtime
  temporário isolado, sem alterar estado operacional, sem pinpad, USB ou
  operações financeiras.

A configuração de CI está preparada em .github/workflows/check.yml; presença
do workflow não significa execução remota. Os resultados acima são locais e
não equivalem a homologação, publicação npm ou autorização de push.


### Verificação focada no Node Windows x64

No Node Windows v24.18.0, os testes novos de resolução/ABI passaram 8/8 e os
testes de transporte stdio/ambiente do filho passaram 9/9. Isso é cobertura
focada, não uma nova execução completa da suíte Windows ou da CI remota.


Os quatro candidatos 0.4.0 foram reempacotados após as mudanças finais.
Consumidores isolados offline em Linux e Windows validaram resolução automática,
descarte do opcional da plataforma estrangeira, erro BRIDGE_NOT_INSTALLED sem
o pacote e fallback por caminho explícito. Cada bridge inclui seis arquivos,
incluindo THIRD_PARTY_NOTICES.txt com as licenças dos 21 crates do Cargo.lock
e os avisos da biblioteca padrão Rust. O gerador usa o grafo locked e falha
se os textos de licença necessários estiverem ausentes.


## Exemplo simples com bridge automática

O exemplo Windows passou a chamar ClientSitef.create sem caminho de bridge,
mantendo o objeto configuration e o fluxo de operações. O build-debug prepara
a dependência local própria para o checkout 0.4.0 ainda não publicado.

- Check agregado no WSL aprovado: core 405 aprovados e 29 exclusivos Windows
  ignorados; UI 20/20; empacotamento/preparo local 26/26.
- Windows: cli-simple 28/28, sem skips; build-debug aprovado.
- Inicialização real com cópia temporária do SDK: seleção automática do pacote,
  load, configure com status 0, primeiro menu e close. A entrada vazia encerrou
  sem iniciar operação. Instrumentação permitiu somente load/configure.
- Nenhuma chamada financeira, mensagem de pinpad ou alteração USB. Os hashes
  dos cinco arquivos DLL/INI originais permaneceram intactos e não restaram
  processos bridge. Outros exemplos não foram alterados.
- Teste de symlink do preparo Windows foi ignorado por falta de privilégio;
  a mesma rejeição de symlink foi exercitada no Linux.


## Método público e restauração da mensagem permanente

A fachada ClientSitef agora expõe escreverMensagemPinpad(message), preservando
o status nativo. O exemplo usa a constante PINPAD_MESSAGE na criação e depois
de cada tentativa com sessão segura. A rodada anterior de inicialização real
não valida esta nova escrita física no equipamento.

- Check final WSL aprovado: 413 core, 34 exclusivos Windows ignorados, 20 UI
  e 26 empacotamento/preparo local.
- Exemplo Windows com transporte sintético: 33/33, incluindo retorno não zero,
  cancelamento, pendências, falha auxiliar e preservação do erro original.
- Guarda explícita para estado uncertain inclui falha de persistência após
  resultado terminal conhecido; sem chamadas auxiliares ou alteração de recovery.
- Rust 12/12 e smoke ABI/IPC próprios aprovados.
- Tarball local do core 0.4.0 regenerado e assinatura pública conferida.
  Consumidor isolado offline aprovou seleção automática e fallback.
- Nenhuma escrita real no pinpad, transação financeira, alteração USB ou
  publicação foi realizada nesta rodada. Build-debug foi restaurado ao final.
