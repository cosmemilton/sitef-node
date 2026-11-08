# Exemplo Windows básico

`examples/windows-simple.mjs` abre/configura a biblioteca uma vez ao iniciar, mostra o menu, processa as operações e fecha o cliente ao sair. O ciclo inteiro está na `main`. O exemplo completo `windows-cli.mjs` permanece separado e intacto.

## Executar e depurar

No PowerShell, na raiz do checkout, com Node Windows x64 e o runtime já preparado:

```powershell
node .\examples\windows-simple.mjs
```

No VS Code **local do Windows**, abra a raiz do checkout (pasta Windows ou UNC) e escolha **SiTef: exemplo simples (Windows)**. Coloque breakpoints na `main`, `transaction.process`, `transaction.confirm` ou `transaction.undo`; use F10/F11. A ponte Rust e a DLL são processos/código nativo separados da depuração JavaScript.

O simples não tem modos de verificação, diagnóstico, ajuda ou execução única. Não recebe opções de linha de comando. Flags antigas são rejeitadas para não carregar a DLL por engano. As opções avançadas continuam no exemplo completo.

## Configuração

Edite o objeto `configuration` no início de `examples/windows-simple.mjs` para definir servidor, loja, terminal e parâmetros adicionais. Os padrões ilustrativos são IP `127.0.0.1`, loja `00000000` e terminal `SR000001`; não comprovam ambiente financeiro simulado. O SDK recebe configuração do chamador, sem fixar esses dados. Variáveis opcionais:

- `SITEF_OPERATOR`: operador; padrão `DEV`.
- `SITEF_TRANSACTION_PARAMS`: parâmetros completos da operação. O exemplo simples usa `configuration.additionalParameters` para os parâmetros de configuração, não `SITEF_CONFIG_PARAMS`.
- `SITEF_PINPAD_MESSAGE`: mensagem permanente inicial opcional.
- `SITEF_ROOT`: pasta da ponte e dos registros. Padrão `%USERPROFILE%\Documents\SiTefDevelopment`.
- `SITEF_RUNTIME`: pasta da DLL. Padrão `runtime\7.0.117.123.r2-win64` dentro da pasta acima.

Pinpad: configuração do INI do runtime. Cupom/data/hora vêm da função auxiliar `transactionInput`; um PDV real deve fornecer seus próprios dados fiscais.

## Fluxo

- Menu 0, 2, 3, 110, 111, 122 e 123; valor prévio para 2, 3 e 122. Demais mensagens/menus/coletas vêm do SiTef. Enter no menu encerra o cliente já aberto.
- Todas as entradas de teclado são visíveis. PIN de cartão fica no pinpad. Não grave nem compartilhe o terminal.
- `result.data` mantém todos os campos, desconhecidos, repetições e bytes originais. O console mostra o retorno e os comprovantes, sem despejar campos livres.
- Cada comprovante é exibido uma vez, inclusive quando vem somente uma via. **Neste exemplo, exibição concluída conta como impressão simulada.** Não exige impressora nem pergunta extra de impressão. Isso não comprova impressão física, assinatura ou ambiente financeiro simulado.
- Sucesso com finalização pede confirmar, desfazer ou manter pendente. Essas chamadas aparecem na `main`. O menu gerencial 110 não é finalizado genericamente só porque retornou recibo. A API informa retorno local, não confirmação remota.
- Ctrl+C solicita cancelamento cooperativo. Erros não repetem operações nem decidem pagamentos. `dispose`/`close` não confirmam nem desfazem.
- A automação mantém metadados desta execução em `state/automation`, sem comprovantes/campos livres. Não inspeciona, remove ou recupera registros anteriores. Não há bloqueio por pendência anterior. O PDV deve tratar reconciliação e requisitos reais de impressão/assinatura.

Os auxiliares existentes cuidam de terminal, interação e recursos do protocolo; não há `runSession` escondendo o fluxo. QR ou comandos sem implementação falham explicitamente como no exemplo completo.

Testes em `packages/core/test/cli-simple.test.mjs` usam SDK real com transporte falso e diretórios temporários. Não executam a DLL do fornecedor nem equivalem à homologação.
