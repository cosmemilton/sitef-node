# Publicações no npm

O workspace raiz é privado. O core `@cosmemilton/sitef` e a UI `@cosmemilton/sitef-ui` já são públicos. A versão 0.4.0 adiciona os subprojetos independentes `@cosmemilton/sitef-bridge-win32-x64` e `@cosmemilton/sitef-bridge-linux-ia32`. Código próprio usa MIT. A versão 0.4.0 dos quatro pacotes está pública no npm, conforme consulta ao registro em 2026-11-17. Preparações posteriores não comprovam publicação.

## Release 0.3.0 publicada em 2026-11-08

- [@cosmemilton/sitef@0.3.0](https://www.npmjs.com/package/@cosmemilton/sitef/v/0.3.0)
- [@cosmemilton/sitef-ui@0.3.0](https://www.npmjs.com/package/@cosmemilton/sitef-ui/v/0.3.0)
- Commit dos artefatos: `5933843af06ca5ec3becef60ced5112514b2416b`.
- Acesso público, licença MIT e `latest=0.3.0` verificados no registro nessa data.
- Tarballs baixados anonimamente; SHA-1 e integridade SHA-512 conferidos:

Core:
```text
SHA-1: 6daefd6af90b94470a64de5d7b4c2fb8e54b13ff
SHA-512: sha512-DkE6eo+ebYLM1tk8TFXsFonr4YuvAINtX9qkvtTxUi1mWeyZn97+3IwvPE4xgM3qiMWgtnQbdgWHh2+9CiMmhg==
```

UI:
```text
SHA-1: 72c6eade9289f4fea5a5d94ae36bab1e646fbb28
SHA-512: sha512-In7m2D+07FdfARDJPlHefs2bQ6EkL+nGwnlOt+0UXAAp7hQ0no6bdiFmqbReX5UTWpYUk7XZUmXpabbY4sXncw==
```

Os READMEs incluídos nesses tarballs refletem a preparação no commit acima.
As atualizações posteriores de documentação no Git registram a publicação;
não alteram nem republicam a versão imutável 0.3.0.
A instalação anônima dos dois pacotes pelo nome e versão, em projeto vazio com
cache novo, também foi verificada. Os registros estão em [validação](validation.md).
Publicação e download público não constituem homologação financeira nem
concedem direitos sobre o SDK ou materiais proprietários do fornecedor.

## Versão 0.4.0 publicada

As duas pontes, o core e a UI 0.4.0 foram publicados em 2026-11-08 e constam
como versão `latest` na consulta de 2026-11-17, antes da publicação 0.4.1 registrada abaixo. O core declara dependências
opcionais com a mesma versão npm; a UI mantém seu peer do core. Os pacotes nativos
são subprojetos independentes, não npm workspaces: assim os filtros os/cpu não
impedem instalar o checkout na outra plataforma. A versão Rust/protocolo permanece
independente da versão dos pacotes npm.

Windows distribui somente o executável próprio x64. Linux distribui somente
o executável próprio i686; o filtro cpu aceita x64 e ia32 porque o processo Node
x64 pode iniciar esse filho de 32 bits. Isso não representa uma biblioteca Linux64.
Veja [instalação e configuração](bridge-distribution.md).

## Checklist para próximas releases

1. Confira nomes, versões disponíveis e permissões no registro npm. Não sobrescreva versões existentes nem confunda a 0.3.0 publicada com esta preparação.
2. Para releases do runtime, sincronize as versões do core, raiz e bridges e as dependências opcionais exatas. A UI pode receber patch independente na mesma linha compatível; confira seu peer do core e atualize o lockfile. Confira compatibilidade do protocolo e das capacidades do bridge.
3. Revise licença e distribuição: LICENSE canônico em todos os pacotes, licenças das dependências e acesso público nos manifests. O workspace raiz continua privado. Nenhuma DLL/SO, INI, certificado, chave, manual ou dado operacional do fornecedor pode entrar nos tarballs.
4. Execute os checks do checkout abaixo, usando fixtures próprias. Registre o que passou, falhou ou não pôde ser executado. Testes de host x64 não substituem execução do bridge Linux i686.
5. Compile cada bridge no alvo correto. Inspecione arquitetura ELF/PE, loader, requisitos glibc, permissões de execução e ausência de caminhos pessoais ou rpaths do laboratório. Use a distribuição mais antiga que pretende suportar como baseline de build Linux.
6. Faça staging e pack de cada pacote nativo em seu ambiente de build. Inspecione os arquivos reais do tarball. Somente o executável próprio aprovado, entrypoint, README, LICENSE, THIRD_PARTY_NOTICES.txt e manifest pertencem ao pacote.
7. Instale os tarballs do core e da ponte correspondente juntos em consumidor isolado, sem depender do checkout. Confira import, tipos e resolução automática; confira também fallback manual e diagnóstico sem dependências opcionais. Teste o instalador final Electron no sistema de destino, se aplicável.
8. Antes de publicar, revise os artefatos exatos, nomes, versão, integridade e autorização. Nenhum desses checks autoriza publicação, push ou execução financeira.

Verificações do checkout:

```sh
npm ci --ignore-scripts
npm run check
cargo test --manifest-path native/Cargo.toml
python3 native/tests/smoke.py
python3 native/tests/smoke_tcp.py
npm run test:integration
npm run pack:check
```

Build/staging Linux (target Rust e multilib precisam estar disponíveis):

```sh
bash scripts/build-linux-ia32.sh
npm run stage:bridge -- linux-ia32
npm run pack:bridge:linux
```

Build/staging Windows:

```powershell
$repo = (Resolve-Path .).Path
$env:CARGO_ENCODED_RUSTFLAGS = @(
  '-Ctarget-feature=+crt-static'
  "--remap-path-prefix=$repo=/sitef"
  "--remap-path-prefix=$env:USERPROFILE=/build-home"
) -join [char]31
cargo build --locked --release --target x86_64-pc-windows-msvc --manifest-path native/Cargo.toml
npm run stage:bridge -- win32-x64
npm run pack:bridge:windows
```

Para cross-build Windows no WSL e execução sintética i686, veja
[native/README.md](../native/README.md). Não instale loaders, conecte pinpad
ou altere permissões USB como efeito colateral do pack.

Os checks de core/UI continuam recusando binários nativos no conteúdo desses
pacotes. Os pacotes bridge têm validação própria de conteúdo e arquitetura,
incluindo rejeição de material proprietário. Ausência de um bridge staged deve
impedir seu empacotamento; não publique um pacote com binário faltando.

O workflow [.github/workflows/check.yml](../.github/workflows/check.yml) prepara
os checks e artefatos por plataforma; [ci/github-actions.yml](../ci/github-actions.yml)
mantém a referência correspondente. Nenhum publica no npm. A presença desses
arquivos não significa que CI remota tenha sido executada: push e execução no
serviço remoto são etapas separadas. Preserve a regra de não incluir SDK ou
segredos em CI.

## Publicação efetiva

A publicação exige autorização explícita do responsável pelos pacotes, depois da
revisão dos nomes, versões, acesso e conteúdo. Não há publicação automática.
Não salve tokens npm no repositório nem os inclua em comandos ou logs compartilhados.

Em uma release conjunta do runtime, publique **primeiro os dois pacotes bridge da versão**, verifique acesso, conteúdo e
integridade no registro, e somente depois publique core e UI dependentes. Omitir
essa ordem pode deixar consumidores sem executável porque uma dependência
opcional ausente não necessariamente faz npm falhar.

Após publicar, teste instalação anônima por nome e versão em cada plataforma
compatível; verifique resolução do bridge e os entrypoints da API. Registre
commit, integridades, hashes, data e limitações de validação. Atualize o changelog
com o que efetivamente foi entregue. Push Git, release GitHub e publicação npm
são operações distintas.

## Runtime proprietário permanece separado

Os pacotes bridge contêm somente código próprio compilado, não uma instalação
pronta do SiTef. O integrador fornece biblioteca de interface, INIs, certificados
e dependências autorizadas do kit conforme seus direitos de uso. Compilação,
download e validação de tarball não equivalem a homologação financeira.
O provisionamento manual por caminho absoluto continua disponível.

## Publicação isolada 0.4.1 em 2026-11-17

Os quatro pacotes foram publicados com `latest=0.4.1`, a partir de preparação isolada baseada na 0.4.0 e nas traduções revisadas. Os downloads públicos foram comparados aos tarballs locais, incluindo integridade SHA-512. A UI publicada mantém `cosmemilton-ui`, sem a migração local para `@cosmemilton/ui`.

O trabalho migratório para `@cosmemilton/ui` permanece separado e não faz parte desta release; sua futura publicação precisa usar uma versão superior a 0.4.1. Esta branch registra exatamente as versões e dependências da publicação isolada.

As pontes próprias foram reconstruídas: Windows PE32+ x64 e Linux ELF32 i686 (glibc mínima 2.34, sem RPATH/RUNPATH). Passaram verificações de arquitetura/conteúdo, mensagens e IPC no Windows sem DLL, 13 testes Rust i686 e fixture ABI/IPC ELF32 no Linux. Nenhum teste financeiro ou homologação foi realizado.

- `@cosmemilton/sitef@0.4.1`: `sha512-CaKA7OK+ATC1i2gS3tTKJmpPiZ0YKD7gU1C3xsoRHxxIIsZw44QhCEgr6PwuIcJHMpB8odpsJYKNbHDOkhTSvA==`.
- `@cosmemilton/sitef-ui@0.4.1`: `sha512-zg7R+FoDttvjF2DAX/hXUYHw0ZwgHHjdVWs4NcIGj2lJN874JOar4nGxMNF+92SiJPz54NNlIbX3RJjLYuPPxA==`.
- `@cosmemilton/sitef-bridge-linux-ia32@0.4.1`: `sha512-qaM5cS2NNzvkAKzCELtH5lvLuHRglyw5hfz+EXMzAWWVLrLVFovqerT/hM+1kjGtu8/+bhEuKEWVvsh03rJ7sA==`.
- `@cosmemilton/sitef-bridge-win32-x64@0.4.1`: `sha512-BOZxPG/xUlaLt9426vC/G6HC6jWqgp7JjTW25d9ERTaI6C81AUSTcO0P2LylTXWsLKTEKpZcr1+cizLTPHHkVg==`.
