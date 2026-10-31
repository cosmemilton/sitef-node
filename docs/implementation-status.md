# Estado da implementação

Este repositório contém uma base funcional, ainda sem homologação financeira.
Os testes automatizados existentes são de contrato e cenários selecionados.
Os testes com a DLL x64 do integrador verificaram carregamento, versão,
configuração, API pública e encerramento; não executaram transações financeiras.

| Referência documental | Cobertura atual |
| --- | --- |
| 5.2.1: retornos | 25 códigos explícitos e duas regras gerais catalogados; não foram provocados todos os cenários de erro |
| 5.2.2: funções | 124 códigos identificados; regras/fluxos por modalidade incompletos |
| 5.3.2: TipoCampo | 444 códigos individuais na referência, 40 com aliases individuais no catálogo; passagem genérica dos demais |

Os PDFs de referência são exclusivamente os do kit x86 mais recente. O runtime
de produção é exclusivamente Windows x64. Nenhum PDF ou binário do fornecedor
acompanha o código. O catálogo usa nomes e descrições factuais de integração;
o material original não é redistribuído.

## Pendências conhecidas

- Exigir e aguardar impressão quando o produto exige comprovante imediato;
  a impressão hoje é um observador opcional implementado pelo integrador.
- Interpretar dicas de formato do campo 2355 e precisões específicas de combustível.
- Disponibilizar cancelamento parcial de conta (`Continua=2`) no modal nos casos válidos.
- Coordenar vários pagamentos TEF pendentes em um mesmo cupom com journal de lote.
- Consultar detalhes de pendências pelas funções 130/131 durante recuperação,
  sem sobrescrever o journal financeiro. Hoje a API em estado incerto expõe contagem.
- Definir política de finalização conforme a modalidade. Atualmente o integrador
  informa `requiresFinalization:false` nas operações não financeiras adequadas.
- Tratar eventos de recursos do pinpad, assinatura e outros requisitos do produto.
- Completar catálogo/semântica dos campos com atenção ao contexto: um mesmo número
  pode ter significado diferente conforme modalidade e configuração.
- Verificar as assinaturas diretas com callback nos headers oficiais e validar Linux
  somente quando o kit correspondente estiver disponível.

Comandos/campos futuros são preservados. A possibilidade de encaminhá-los para
callbacks não deve ser apresentada como implementação completa do seu significado.
