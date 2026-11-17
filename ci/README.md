# Integração contínua

O fluxo canônico é [check.yml](../.github/workflows/check.yml), com uma cópia de referência correspondente neste diretório. Ele foi preparado localmente e só é executado por push, pull request ou acionamento manual depois que essas alterações forem registradas em commit e enviadas. Não se afirma que houve execução remota da integração contínua.

A tarefa Linux testa os contratos próprios TypeScript/Rust/C e o catálogo gerado;
em seguida, executa `npm run pack:check` para inspecionar o conteúdo dos pacotes sem publicar.
Ela não fornece o ambiente de execução proprietário do fornecedor. Uma tarefa separada no Ubuntu 22.04 compila a ponte Linux i686 própria com ferramentas multilib. A tarefa Windows executa `npm ci` e
`npm run check`, depois compila a ponte x64 de produção sem carregar uma DLL do fornecedor. Nenhuma tarefa realiza
operações financeiras, usa credenciais do fornecedor ou baixa bibliotecas proprietárias.
As duas tarefas nativas preparam e empacotam o subprojeto de sua plataforma e enviam o tarball npm gerado como artefato do GitHub Actions. Não há publicação no npm, publicação de GitHub Release nem implantação configurada.

O modelo pressupõe que o arquivo de dependências fixadas do npm registrado no repositório e as dependências de desenvolvimento e peer
possam ser instalados. Este fluxo não foi executado pelo GitHub Actions neste
projeto. Sua presença não comprova uma execução bem-sucedida da integração contínua. Confira o
resultado do Actions para o commit exato antes de informar sucesso; verificações locais
são separadas, e os resultados históricos estão identificados nos documentos de validação.

O modelo fixa as ações em SHAs de commits correspondentes às tags v7.0.0
verificadas. Revise as versões dos projetos de origem antes de habilitá-lo
ou atualizá-lo: [checkout](https://github.com/actions/checkout/releases),
[setup-node](https://github.com/actions/setup-node/releases), [upload-artifact](https://github.com/actions/upload-artifact/releases) e
[setup-python](https://github.com/actions/setup-python/releases).

A inspeção dos artefatos npm e a autorização são etapas separadas, descritas na
[preparação de publicação](../docs/releasing.md). Testes com bibliotecas sintéticas
não equivalem a homologação financeira.
Os pacotes de plataforma são subprojetos deliberadamente independentes, não espaços de trabalho npm: um espaço de trabalho com restrição os/cpu de outra plataforma causa EBADPLATFORM no npm. O núcleo os declara como dependências opcionais. Bibliotecas do ambiente de execução nunca são copiadas para os artefatos. O binário Linux tem glibc como alvo, não musl; valide seus requisitos mínimos de GLIBC em cada distribuição compatível antes de publicar.
