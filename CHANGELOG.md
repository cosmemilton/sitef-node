# Changelog

As alterações abaixo descrevem o código e a documentação. Uma versão do código não comprova publicação no npm, execução em produção ou homologação SiTef.

## 0.3.0 — em preparação

- Fachada `ClientSitef` com inicialização única e objetos `Transaction` para processamento, callbacks, cancelamento e decisão explícita por operação.
- Resultados completos e parciais com campos conhecidos, desconhecidos, repetidos e bytes preservados.
- Exemplo de referência `examples/windows-simple.mjs`, com menu após inicialização da DLL, impressão simulada em tela e confirmação/desfazimento explícitos.
- CLI completa e ferramenta de reconciliação mantidas como opções avançadas.
- Documentação reorganizada em torno do exemplo simples, do ciclo de vida e dos limites operacionais; preparação dos pacotes npm e seus READMEs.

Os artefatos foram verificados localmente; a publicação npm é uma etapa separada e não foi realizada. Licença mantida como `UNLICENSED`. Ponte Windows x64 e componentes proprietários continuam fora dos pacotes npm. A API anterior permanece disponível; revise as políticas de finalização e persistência ao adotar a nova fachada.

## 0.2 — base anterior

Catálogo semântico, validação de campos, snapshots e recuperação explícita, ponte Rust isolada e modal React opcional. Os registros históricos de testes estão em `docs/validation.md`; não equivalem a homologação financeira ou evidência de publicação.