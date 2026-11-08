# Depurar no VS Code local do Windows

Use o VS Code **local do Windows** e `node.exe` x64 para executar a ponte e a DLL. O checkout pode estar em uma pasta Windows ou em um compartilhamento UNC do WSL. A depuração não exige uma distribuição ou um diretório pessoal específicos.

## Preparação

1. Abra a raiz do checkout no VS Code local. Se a janela estiver conectada ao WSL, use a opção de reabrir a pasta no Windows. Não execute a DLL a partir de Node Linux.
2. Instale as dependências e provisione a ponte e o kit autorizado conforme o README.
3. Os perfis usam `%USERPROFILE%\Documents\SiTefDevelopment` como diretório de trabalho; essa pasta precisa existir. Se escolher outro diretório, ajuste `cwd` em `.vscode/launch.json`. `SITEF_ROOT` ou `--diretorio` não alteram o `cwd` do debugger.
4. Execute a tarefa **SiTef: compilar TypeScript (debug)**. Ela chama `scripts/build-debug.mjs` com Node Windows e gera os mapas embutidos do core, sem carregar a DLL. Não depende de npm/Node Linux ou de um caminho de usuário fixo.

O build de debug compila somente o core, suficiente para as CLIs, usando `packages/core/tsconfig.debug.json`. Ele não compila nem testa a UI. Para validar todo o workspace, execute `npm run check` no WSL com dependências Linux ou em um checkout Windows com dependências instaladas por `npm ci` no Windows; não reutilize links de workspaces criados no Linux para esse build completo no Windows. Um build/check normal pode substituir os mapas embutidos; execute a tarefa novamente antes de depurar TypeScript. Os arquivos `.mjs` dos exemplos são fontes JavaScript diretas.

## Exemplo principal

Escolha **SiTef: exemplo simples (Windows)** em Run and Debug. Esse perfil compila antes de iniciar, usa terminal integrado e para na entrada. Configure o objeto `configuration` de `examples/windows-simple.mjs` antes de continuar: **a DLL é carregada antes do menu**, não depois da primeira escolha.

Breakpoints úteis:

- `examples/windows-simple.mjs`: `ClientSitef.create`, `transaction.process`, `transaction.confirm`, `transaction.undo` e `client.close`.
- `examples/cli/interaction.mjs`: callbacks de mensagens, menus, coleta e comprovantes.
- `packages/core/src/transaction.ts`: criação e processamento de `Transaction`.
- `packages/core/src/session.ts`: ciclo nativo e finalização.
- `packages/core/src/transport.ts`: `BridgeTransport.call`.

Use os botões da barra de depuração ou os atalhos configurados no seu editor. Os padrões usuais são F5 para continuar, F10 para avançar e F11 para entrar na chamada. Step Into não entra no processo Rust nem na DLL; isso exige depuração nativa separada.

O terminal exige stdin/stdout TTY. Não use Debug Console para entradas interativas e não redirecione a saída. As entradas são visíveis e os comprovantes aparecem em tela. Não grave a sessão nem use logpoints sobre resultados, buffers ou comprovantes.

## Ferramentas opcionais

- **SiTef: verificar arquivos (sem DLL)** executa `examples/windows-cli.mjs --verificar`. Confere somente existência de arquivos. Não carrega a DLL, inicia venda ou comprova origem, dependências, versão, INI, compatibilidade ou ambiente simulado. Execute a tarefa de compilação antes, se necessário.
- **SiTef: CLI interativa (Windows)** usa o exemplo completo, com suas opções adicionais. Pode carregar a DLL e iniciar operações; não é um teste inofensivo por definição.
- **SiTef: inspecionar journal (somente leitura)** usa `windows-reconcile.mjs --inspecionar`, sem DLL. Para selecionar um snapshot novo, inclua `--registro` e o caminho absoluto conhecido no array `args`. Não escolha um arquivo por ser o mais recente. Sem esse argumento, a ferramenta usa o caminho legado.

Somente os perfis da CLI completa aceitam opções como `--runtime`, `--verificar` e `--diagnostico`. O exemplo simples rejeita opções e usa o objeto de configuração mais as variáveis descritas no [guia próprio](windows-simple.md).

## Cancelamento e estado financeiro

Pausar Node não congela a DLL, o pinpad ou seus timeouts. Para cancelar cooperativamente, continue a execução, use Ctrl+C no terminal e aguarde o resultado. Stop encerra ou desconecta o processo e pode deixar estado incerto; não comprova desfazimento.

O exemplo apresenta comprovantes como impressão simulada, sem impressora física. Assinatura e demais obrigações continuam sob responsabilidade da automação. Confirmação e desfazimento são decisões explícitas; retorno local não confirma o estado remoto.

Pendências anteriores não impedem uma nova operação. `dispose()` e `close()` não decidem pagamentos; `close()` exige ausência de operação ativa. Preserve registros e locks. Nunca apague estado nem repita automaticamente uma operação incerta. Consulte [estado e recuperação](application-state.md) antes de reconectar, consultar ou decidir.

## Limites da verificação

A configuração do debugger e os testes sintéticos não equivalem a validação visual atual, execução da DLL, teste físico de pinpad/impressora ou homologação. Registre separadamente qualquer teste que realizar. Os resultados históricos da base anterior estão em [validação](validation.md), não certificam os perfis atuais.