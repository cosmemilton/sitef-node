# Changelog

As alterações abaixo descrevem o código e a documentação. Uma versão do código não comprova publicação no npm, execução em produção ou homologação SiTef.

## 0.4.0

- Distribuição da ponte própria em pacotes opcionais Windows x64 e Linux i686, mantendo o core enxuto e sem SDK proprietário.
- Resolução automática da ponte por plataforma, com prioridade para caminhos manuais e diagnóstico de pacote ausente.
- Linux glibc: ponte i686 isolada para libclisitef.so ELF32, inclusive com Node/Electron x64. Outras ABIs não são inferidas.
- Preparação de build, inspeção de artefatos, testes e documentação independente para instalação e Electron.
- Método público `client.escreverMensagemPinpad(message)` com status nativo fiel e guardas de ciclo; exemplo simples restaura a mesma mensagem após tentativas concluídas com sessão segura.
- Exemplo simples com seleção automática da bridge; build-debug prepara o pacote local sem rede ou SDK proprietário.
- A disponibilidade no registro e a execução de CI são verificadas separadamente; esta versão não representa homologação financeira.

## 0.3.0 — publicada em 2026-11-08

- Publicados no npm com acesso público: [@cosmemilton/sitef@0.3.0](https://www.npmjs.com/package/@cosmemilton/sitef/v/0.3.0) e [@cosmemilton/sitef-ui@0.3.0](https://www.npmjs.com/package/@cosmemilton/sitef-ui/v/0.3.0).
- Artefatos do commit `5933843af06ca5ec3becef60ced5112514b2416b`; download anônimo e hashes SHA-1/SHA-512 conferidos. Os dois pacotes foram verificados com `latest=0.3.0` nessa data.
- Fachada `ClientSitef` com inicialização única e objetos `Transaction` para processamento, callbacks, cancelamento e decisão explícita por operação.
- Resultados completos e parciais com campos conhecidos, desconhecidos, repetidos e bytes preservados.
- Exemplo de referência `examples/windows-simple.mjs`, com menu após inicialização da DLL, impressão simulada em tela e confirmação/desfazimento explícitos.
- CLI completa e ferramenta de reconciliação mantidas como opções avançadas.
- Instalação real dos tarballs em consumidor isolado, tipos públicos estritos, bundle React e integração com a ponte/fixture próprias verificados.
- Documentação reorganizada em torno do exemplo simples, do ciclo de vida e dos limites operacionais; preparação dos pacotes npm e seus READMEs.

A preparação e a validação local antecederam a publicação. O registro completo dos artefatos publicados está em [releases npm](docs/releasing.md). Código próprio licenciado sob MIT, com LICENSE incluído nos dois pacotes e acesso público configurado. Ponte Windows x64 e componentes proprietários continuam fora dos pacotes npm. A API anterior permanece disponível; revise as políticas de finalização e persistência ao adotar a nova fachada.

## 0.2 — base anterior

Catálogo semântico, validação de campos, snapshots e recuperação explícita, ponte Rust isolada e modal React opcional. Os registros históricos de testes estão em `docs/validation.md`; não equivalem a homologação financeira ou evidência de publicação.
