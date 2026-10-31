# Convenções do projeto

- Linguagem pública TypeScript, bridge nativo Rust em processo isolado.
- Não copiar nem distribuir código Delphi, código de integrações terceiras,
  bibliotecas, certificados, INIs ou PDFs do fornecedor.
- Bibliotecas nativas são fornecidas pelo integrador e carregadas por caminho absoluto.
- Runtime suportado exclusivamente Windows x64. PDFs de referência são somente os do kit x86 mais recente; não usar PDFs do kit x64.
- Nunca usar CmAlert ou componentes similares para notificações. Usar CmToast/CmToastNotice.
- Reutilizar componentes compartilhados e tokens cosmemilton-ui; verificar temas claro/escuro.
- Preservar teclado, leitura e espaço em desktop/celular. Agrupar ações relacionadas quando adequado.
- Nunca ignorar códigos, campos ou parâmetros novos. Preservar valores brutos e falhar explicitamente em interação sem implementação.
- Nunca repetir automaticamente operações financeiras após timeout/crash; nunca confirmar em finally.
- Não logar PIN, PAN, trilhas, chave de segurança, campos livres ou comprovantes.
- Após mudanças: npm run check; cargo test --manifest-path native/Cargo.toml; python3 native/tests/smoke.py.
- Testes sintéticos não equivalem a homologação nem validam ABI Linux do fornecedor.
