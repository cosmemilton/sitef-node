# Bridges Windows e Linux: instalação e operação

Este guia descreve a versão **0.4.0**, com pontes opcionais por plataforma.
A versão anterior 0.3.0 usa Windows x64 com ponte manual. Quando a 0.4.0
estiver disponível no registro, instale somente o core com dependências
opcionais habilitadas: npm install @cosmemilton/sitef@0.4.0.
O fluxo de tarballs abaixo permite validar o checkout antes da publicação
ou distribuir artefatos próprios em um ambiente de teste.

A ponte é código próprio Rust executado como processo separado. **Nenhum pacote
inclui ou baixa o kit CliSiTef**, seus INIs, certificados, chaves ou manuais.
Disponibilidade técnica não equivale a homologação financeira.

## 1. Escolha o alvo correto

| Host Node/Electron | Ponte opcional | Biblioteca do integrador |
| --- | --- | --- |
| Windows x64 | `@cosmemilton/sitef-bridge-win32-x64` | Interface x64, como `CliSiTef64I.dll` |
| Linux glibc x64 ou ia32 | `@cosmemilton/sitef-bridge-linux-ia32` | `libclisitef.so` ELF32 Intel 386 |

Node deve ser >=22.18.0. No Electron, confira a versão do Node embutido.
O nome `linux-ia32` descreve o **executável filho**, não exige que Node seja 32 bits.
Esse pacote aceita hosts npm x64 e ia32. Não há conversão de ABI dentro do processo.
A ponte Linux x64 compilada para fixtures não serve à biblioteca Linux32.

Windows ARM/ia32, Linux ARM, Alpine/musl e a biblioteca Linux x64 não são alvos
desta distribuição. Uma DLL interna `CliSiTef.dll` não substitui a interface Windows.

## 2. Prepare o sistema e o kit autorizado

Obtenha o kit correto com o fornecedor/integrador. Mantenha-o fora de
`node_modules`, separado dos artefatos públicos. Use caminhos absolutos e um
diretório operacional gravável pelo usuário do serviço. Nunca use a pasta do
pacote instalado como local de dados operacionais.

**Linux:** o artefato preparado exige glibc **>=2.34**, suporte i386 no kernel
e o loader glibc de 32 bits
`/lib/ld-linux.so.2`, libc/libgcc e as dependências 32-bit do kit precisam existir.
Em Debian/Ubuntu, os pacotes de runtime normalmente incluem `libc6-i386` e
`lib32gcc-s1`. Libstdc++ de 32 bits pode ser necessária para componentes do
fornecedor. Dependências adicionais variam com o kit; o administrador deve
verificá-las. Compilar requer também Rust com target `i686-unknown-linux-gnu`
e GCC multilib. Essas instalações de sistema não são feitas pelo npm.

Inspecione somente binários confiáveis do kit autorizado:

```sh
file /opt/sitef/runtime/libclisitef.so
readelf -d /opt/sitef/runtime/libclisitef.so
readelf --version-info /opt/sitef/bin/sitef-bridge
```

O último comando verifica requisitos glibc do bridge que você de fato distribuirá.
Compilar em uma distribuição recente não garante execução em uma mais antiga.
O artefato Linux local desta preparação foi inspecionado com requisito máximo
`GLIBC_2.34`, interpreter `/lib/ld-linux.so.2` e sem RPATH/RUNPATH. Isso descreve
esse build, não uma promessa para todo artefato futuro; confira novamente em CI
e antes de cada release.
`readelf -d` mostra dependências declaradas, mas não substitui a validação de
dependências carregadas dinamicamente pelo fornecedor.

Quando o kit usa outras SOs ao lado da principal, configure `LD_LIBRARY_PATH`
**antes de iniciar a ponte**, pelo ambiente exclusivo do processo filho:

```js
// Adicione esta propriedade às opções de ClientSitef.create:
bridgeEnv: { LD_LIBRARY_PATH: '/opt/sitef/runtime' }
```

A ponte herda o ambiente do Node e aplica esses valores somente no filho.
Não é necessário alterar `process.env` global nem registrar o ambiente em logs.
Isso configura a busca de dependências, não instala o loader ou bibliotecas.

Use somente diretórios confiáveis. Não acrescente componentes vazios nem inclua
a pasta atual indiscriminadamente. `workingDirectory` não altera o caminho de
busca do loader. Não copie SOs proprietárias para o pacote da ponte.

No Windows, mantenha a interface e os demais arquivos autorizados no layout
recomendado pelo fornecedor. No Linux, configure dispositivo e INI específicos
do sistema: COM do Windows não é um caminho de dispositivo Linux. A instalação
npm não conecta USB nem altera permissões de dispositivos.

## 3. Gere os pacotes localmente

No checkout, instale as dependências e compile o SDK:

```sh
npm ci --ignore-scripts
npm run build
```

Para Linux, com o target Rust e multilib já instalados:

```sh
bash scripts/build-linux-ia32.sh
npm run stage:bridge -- linux-ia32
npm run pack:bridge:linux
npm pack --workspace @cosmemilton/sitef
```

Para Windows, em um host Windows com Rust/MSVC e Windows SDK:

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
npm pack --workspace @cosmemilton/sitef
```

Execute na raiz do checkout. O target Rust precisa estar instalado. As flags
usam CRT estático e removem caminhos locais do repositório e perfil do binário;
o separador ASCII 31 preserva caminhos com espaços. Se CARGO_HOME aponta para
outro diretório pessoal, adicione um remapeamento para ele antes do build.
O prepack rejeita caminhos pessoais incorporados. Para cross-build no WSL, veja
[as instruções nativas](../native/README.md) e `scripts/build-windows-x64.sh`.
Os subprojetos nativos são deliberadamente independentes dos npm workspaces,
evitando erros `EBADPLATFORM` durante a instalação do checkout na outra plataforma.
O staging inspeciona a arquitetura antes de copiar o binário para seu pacote.
O guard também recusa caminhos pessoais e, no Linux, exige o interpreter padrão
sem RPATH/RUNPATH. O script Linux já aplica o remapeamento de caminhos.

Em uma aplicação vazia **na plataforma correspondente**, instale o tarball do
bridge e o core juntos. Exemplo Linux, ajustando os caminhos dos arquivos gerados:

```sh
npm init -y
npm install --ignore-scripts /caminho/artefatos/cosmemilton-sitef-bridge-linux-ia32-0.4.0.tgz /caminho/artefatos/cosmemilton-sitef-0.4.0.tgz
node --input-type=module -e "import { resolveBridge } from '@cosmemilton/sitef'; console.log(resolveBridge().executable)"
```

No Windows, substitua o primeiro tarball por
`cosmemilton-sitef-bridge-win32-x64-0.4.0.tgz` e use caminhos Windows.
Resolver o caminho não carrega a biblioteca e não executa uma operação.
Não use o diretório do checkout como único teste de instalação: ele pode mascarar
dependências ausentes. A UI é opcional e não é necessária para resolver a ponte.

Depois de uma publicação autorizada dos quatro pacotes, instalar o core 0.4.0
com dependências opcionais habilitadas deverá instalar somente a ponte compatível.
O core fixa a versão dos bridges; não misture versões ou publique o core antes deles.

## 4. Inicialize uma vez

Salve este exemplo como `app.mjs` na aplicação. Ele carrega e configura o kit
autorizado, depois fecha o cliente; **não inicia uma transação nem testa pinpad**.

```js
import { ClientSitef } from '@cosmemilton/sitef';

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error('Defina ' + name);
  return value;
};

const client = await ClientSitef.create({
  // Caminho absoluto da interface x64 no Windows ou libclisitef.so ELF32 no Linux.
  libraryPath: required('SITEF_LIBRARY'),
  // Pasta operacional absoluta, gravável e preparada conforme seu kit.
  workingDirectory: required('SITEF_RUNTIME'),
  ...(process.platform === 'linux' ? {
    bridgeEnv: { LD_LIBRARY_PATH: required('SITEF_RUNTIME') }
  } : {}),
  configuration: {
    server: required('SITEF_SERVER'),
    storeId: required('SITEF_STORE'),
    terminalId: required('SITEF_TERMINAL')
  }
});
await client.close();
```

Defina as cinco variáveis com os dados do seu ambiente autorizado, não valores
de uma instalação alheia. A criação pode carregar/configurar componentes do kit;
use o ambiente de testes apropriado. Não marque `testMode: true` para contornar
arquitetura ou validação de uma biblioteca do fornecedor.

Para operações, implemente os callbacks documentados, crie uma transação por
tentativa e tome decisões de confirmação/desfazimento explicitamente. O exemplo
`examples/windows-simple.mjs` continua específico de Windows e depende dos
auxiliares do checkout. Consulte [cliente e transações](client-transactions.md).

## 5. Provisionamento manual e dependências opcionais

Um caminho explícito tem prioridade sobre qualquer pacote instalado:

```js
const client = await ClientSitef.create({
  bridgeExecutable: '/opt/sitef/bin/sitef-bridge',
  // bridgeDirectory é opcional; assume a pasta do executável.
  libraryPath: '/opt/sitef/runtime/libclisitef.so',
  workingDirectory: '/var/lib/sitef',
  configuration
});
```

`configuration` deve conter os dados autorizados da seção anterior. No Windows,
use caminhos absolutos Windows e o executável `sitef-bridge.exe`.
`bridgeDirectory` é o cwd inicial do processo filho; `workingDirectory` é aplicado
dentro da ponte para a biblioteca. Nenhum deles muda o cwd do processo Node.

`npm install --omit=optional`, configurações equivalentes ou uma dependência
opcional que falhou podem deixar o core instalado sem bridge. Instale o pacote
correto explicitamente ou forneça `bridgeExecutable`. O SDK não baixa outro
executável, não recompila silenciosamente e não escolhe uma ABI diferente.

## 6. Electron e empacotadores

Execute o SDK no processo principal Node, nunca diretamente no renderer.
Exponha por IPC somente operações e dados necessários, com validação de origem
e argumentos. Não exponha uma API genérica para chamadas nativas.

Binários não podem ser executados dentro do arquivo ASAR. Configure o
empacotador para incluir o pacote opcional da plataforma de destino e extrair
seu executável para arquivo real, preservando permissão de execução no Linux.
Se o caminho resolvido apontar para ASAR, forneça `bridgeExecutable` absoluto
no diretório de recursos extraídos. Provisione o kit proprietário fora do ASAR
e os dados operacionais em diretório gravável, separado dos recursos somente leitura.

Em cross-build, a plataforma do computador que executa npm pode ser diferente
da plataforma de destino. Não confie na filtragem automática do host para montar
o instalador de outra plataforma. Prepare o bridge correspondente ao destino,
verifique sua presença e teste o instalador nesse sistema. Não há addon Node
no bridge, portanto não depende do ABI de addons do Electron; continuam valendo
a versão mínima do Node embutido, a arquitetura do executável e os requisitos de SO.

## Diagnóstico e limites

- `BRIDGE_NOT_INSTALLED`: confira dependências opcionais, pacote da plataforma,
  presença e permissão de execução do binário. Use fallback manual quando necessário.
- `BRIDGE_SPAWN` com arquivo existente no Linux: confira loader i386, permissão de
  execução, montagem `noexec`, arquitetura e requisitos glibc. Não relaxe segurança
  do sistema indiscriminadamente.
- Falha ao carregar biblioteca: verifique ELF32/PE x64, caminho absoluto, arquivos
  auxiliares e dependências do kit. Estar no mesmo diretório não resolve sozinho a
  busca de SOs no Linux.
- `UNSUPPORTED_PLATFORM` ou `UNSUPPORTED_ARCHITECTURE`: não substitua o bridge
  i686 por x64, nem use `testMode` com kit proprietário.
- Timeout/crash: resultado nativo pode ser incerto. Não repita operação financeira,
  não confirme em `finally` e não apague pendências para desbloquear a aplicação.

Não registre PIN, PAN, trilhas, chaves, campos livres ou comprovantes. Fechar o
cliente não confirma nem desfaz pagamentos. Testes de fixtures e comunicação
não comprovam pagamentos, cancelamentos, impressão, pinpad ou reconciliação
homologados. Para os passos de build/release e seus limites, consulte
[releases](releasing.md) e [host nativo](../native/README.md).
