# Modal de interação CliSiTef

A versão 0.4.1 recebe os DTOs semânticos do engine `@cosmemilton/sitef` 0.4.1. O controller usa o validador puro e compatível com navegador de `@cosmemilton/sitef/fields`, sem carregar Node, DLL ou filesystem no renderer.

Pacote opcional React. O pacote Node `@cosmemilton/sitef` funciona com callbacks próprios sem instalar UI. Quem escolhe este modal instala obrigatoriamente `cosmemilton-ui@^4.1.0`, React e ReactDOM. `@iconify/react` também é declarado peer porque o entrypoint interativo da cosmemilton-ui 4.1.0 o importa ao montar o bundle, mesmo para componentes sem ícones. A biblioteca do fornecedor continua sendo fornecida pelo integrador no host Node.

A versão 0.4.1 mantém as dependências e a API da versão 0.4.0. Esta atualização esclarece a distribuição pública da ponte e uniformiza a documentação em português, sem migrar o design system.

## Instalação

O modal, o SDK e as pontes são distribuídos publicamente pelo npm. Os comandos abaixo correspondem à versão 0.4.1.
Instale o modal e suas dependências peer
na aplicação React (o core também precisa estar disponível no host Node):

```sh
npm install @cosmemilton/sitef@0.4.1 @cosmemilton/sitef-ui@0.4.1 cosmemilton-ui@^4.1.0 "@iconify/react@>=5" "react@>=18.2 <20" "react-dom@>=18.2 <20"
```

```js
import { SitefModal, createSitefModal } from '@cosmemilton/sitef-ui';
import { CmThemeProvider, CmToastProvider } from 'cosmemilton-ui/client';
import 'cosmemilton-ui/styles.css';
```

Use o [exemplo Windows simples](https://github.com/cosmemilton/sitef-node/blob/main/examples/windows-simple.mjs)
como referência para o ciclo do host. Ele usa callbacks de terminal, não monta
este modal; a ligação com o frontend requer o transporte descrito abaixo.
A ponte Rust própria já é distribuída publicamente no npm desde a versão 0.4.0, em pacotes separados:

- Windows x64: [`@cosmemilton/sitef-bridge-win32-x64`](https://www.npmjs.com/package/@cosmemilton/sitef-bridge-win32-x64).
- Linux glibc, com Node x64 ou ia32: [`@cosmemilton/sitef-bridge-linux-ia32`](https://www.npmjs.com/package/@cosmemilton/sitef-bridge-linux-ia32), cujo executável é i686 e usa a biblioteca CliSiTef ELF32.

No host Node, instalar `@cosmemilton/sitef@0.4.1` com dependências opcionais habilitadas instala a ponte compatível. Não é necessário obter um executável privado nem compilar Rust para usar esses pacotes. Se a instalação opcional falhar ou for desabilitada, instale o pacote correto explicitamente ou configure `bridgeExecutable` com um caminho absoluto.

A UI não executa a ponte diretamente: o fluxo é **modal React → transporte da aplicação → SDK Node → ponte Rust → biblioteca CliSiTef**. A DLL/SO e os demais arquivos proprietários do fornecedor não são incluídos nem baixados pelos pacotes; o integrador fornece seu kit autorizado. O host exige Node.js >=22.18.0. No Linux, são necessários glibc e runtime de 32 bits compatíveis; não há suporte a ARM, musl/Alpine ou biblioteca Linux x64 nesta distribuição. Consulte os [requisitos e o empacotamento Electron](https://github.com/cosmemilton/sitef-node/blob/main/docs/bridge-distribution.md).

## Integração

Importe `cosmemilton-ui/styles.css` uma vez no frontend e monte `SitefModal` dentro dos providers `CmThemeProvider` e `CmToastProvider` de `cosmemilton-ui/client`. Crie uma instância do controller por sessão com `createSitefModal({ onCancel: () => abortController.abort() })`. Na API `ClientSitef`, encaminhe as interações ao controller com `transaction.process({ raw: controller.handler })` e configure `onExchange: controller.onExchange` ao criar o cliente; na API `createSitef`, use `interaction: controller.handler`. Esses exemplos descrevem o vínculo lógico: em Electron ou navegador, implemente a passagem dos DTOs pelo transporte da aplicação, sem importar o SDK nativo no renderer. Chame `complete()` depois que a execução do SDK encerrar o loop. O controller não confirma nem desfaz a venda financeira: a aplicação decide isso separadamente pelo SDK e pelo resultado fiscal.

As perguntas são respondidas pelo operador. Menus preservam o índice SiTef, sem seleção automática. Mensagens de operador e cliente são distintas. O QR permanece no mesmo modal e sua exibição retorna imediatamente ao loop. Os erros de validação e resultados operacionais usam toast sem deslocar a página. Os comandos de PIN no pinpad não são transformados em campos HTML pelo modal.

O formato 2355 pode transformar uma coleta 30 em menu (`M`), menu com confirmação (`Mc`) ou escolhas Sim/Não (`S`). Em `Mc`, selecionar a opção abre uma segunda etapa; somente a confirmação explícita devolve `confirmed: true`. É possível alterar a escolha antes de enviar. Em `S`, o core precisa fornecer `semantic.choices` com a codificação do produto; o modal não inventa valores S/N ou 0/1. Os formatos alfabético, sem acentos, numérico, decimal e datas usam a validação compartilhada. `semantic.sensitive` também mascara coletas fora do comando 41.

O comando 29 exige `systemData`: sua informação vem da aplicação, sem mostrar ou solicitar ao operador. Comandos futuros exigem `onUnsupported` ou falham de forma explícita; o core solicita cancelamento e conserva o código bruto. Os campos desconhecidos do comando 0 continuam disponíveis no core. `onExchange` do core pode ser usado para persistir dados necessários e imprimir comprovantes no momento exigido pelo produto; não registre o buffer inteiro.

Coletas especiais: cheque retorna `0:` (primeira linha), `1:` (leitor CMC-7) ou `2:` (CMC-7 digitado). Código de barras retorna `0:` manual ou `1:` leitor; “Cancelar esta coleta” devolve `2:` e mantém os documentos anteriores. Isto é diferente do cancelamento total da transação. Configure `validateBarcode: (data) => client.validateBarcode(data)` para verificar a integridade pelo fornecedor antes de devolver o dado; somente retorno 0 é aceito. A interface bloqueia envio duplicado durante a validação e mantém a coleta aberta em caso de erro, informado por toast. Sem esse callback, apenas formato e tamanho são verificados. Integração com leitora física e requisitos do produto/homologação continuam pertencendo à aplicação.

Nas coletas Corban de vencimento/valor 600 e 601, `semantic.canCancelBill` habilita “Cancelar conta”, que envia `continueFlag: 2`. O controller confere domínio e campo antes de aceitar esse controle. O botão é diferente do payload `2:` usado pelo comando de barras 35.

Valores monetários permanecem strings decimais; não há conversão por ponto flutuante. `request.semantic` produzido pelo core determina formato, precisão e escolhas. O fallback de `controller.onExchange` observa 2470, 1121, 1126 e 2355 para integrações sem o processador completo: precisão geral, preço unitário, quantidade e formato seguinte ficam separados. O formato seguinte é consumido uma vez; `complete()` reinicia os contextos. Metadado inválido falha explicitamente. Se já usa outro observador, componha ambos e propague falhas. No transporte do renderer, encaminhe apenas os metadados necessários como evento `exchange`, sem enviar todos os campos retornados ao navegador. A validação de tamanho usa Windows-1252 por padrão e rejeita caracteres não representáveis. Para UTF-8, configure `nativeEncoding: 'utf-8'` e `byteLength: (value) => new TextEncoder().encode(value).length` de forma consistente com o host. O host também valida seus buffers. Não use `continueFlag=10000` por meio deste modal; dados previamente coletados exigem integração e confirmação próprias conforme autorização do fornecedor.

## Browser, Electron e transporte

Node sozinho não abre um modal React. No Electron, o SDK e o processo nativo rodam no main; o renderer recebe somente DTOs de interação por um preload restrito, sem `nodeIntegration`. Uma aplicação web precisa de um agente local e transporte autenticado, vinculado à sessão do caixa, com IDs de transação/coleta, verificação de origem e apenas uma resposta aceita por coleta. Este pacote não abre servidor HTTP, WebSocket ou porta local. Não envie ao navegador caminhos da DLL, credenciais, configuração do terminal ou métodos nativos genéricos.

No renderer, conecte `createSitefModal` à interface restrita do transporte: ao receber uma coleta, execute `handler(request,{signal})` e devolva somente `{requestId,response}`. O requestId precisa ser validado novamente no processo Node. Use `controller.complete()` quando o main comunicar encerramento do loop, e `controller.reportError(message)` para mensagens operacionais já filtradas. O botão Cancelar chama seu `onCancel`, que encaminha cancelamento cooperativo ao AbortController do SDK. Não mate o processo para cancelar uma transação.

## Validação

No checkout do repositório, `npm run check --workspace @cosmemilton/sitef-ui` compila a API React e testa o controller. A integração de produção ainda exige validação visual/teclado em claro e escuro, hardware e homologação SiTef, além de persistência/impressão de comprovantes e recuperação de pendências pela aplicação.

## Distribuição e licença

Licença do código próprio: [MIT](LICENSE), copyright 2026 cosmemilton. Dependências mantêm suas próprias licenças. O tarball de `@cosmemilton/sitef-ui` contém somente a interface e o controller JavaScript/TypeScript. A ponte Rust própria é MIT e está disponível nos pacotes públicos de plataforma instalados pelo SDK, descritos acima. O kit CliSiTef proprietário permanece separado e sujeito aos direitos do fornecedor, sem concessão por esta licença. A interface não confirma pagamentos por conta própria. A publicação no npm não comprova homologação financeira.
