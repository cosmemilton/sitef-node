# Continuous integration template

`github-actions.yml` is an inactive template. Copy it to
`.github/workflows/check.yml` to enable repository CI. Keeping it under `ci/`
does not enable GitHub Actions.

The Linux job tests owned TypeScript/Rust/C contracts and the generated catalog,
then runs `npm run pack:check` to inspect package contents without publishing.
It does not provide a Linux vendor runtime. The Windows job runs `npm ci` and
`npm run check`, then compiles the production x64 helper without loading a vendor DLL. Neither job performs
financial operations, uses vendor credentials or downloads proprietary libraries.
No npm publication, release upload or deployment is configured.

The template expects the committed npm lockfile and development/peer dependencies
to be installable. This template has not been executed by GitHub Actions in this
project. Its presence does not establish a successful CI run. Check the
Actions result for the exact commit before reporting CI success; local checks
are separate and historical results are identified in the validation documents.

The template pins actions to commit SHAs corresponding to the verified v7.0.0
tags. Review the upstream releases before enabling
or updating it: [checkout](https://github.com/actions/checkout/releases),
[setup-node](https://github.com/actions/setup-node/releases), and
[setup-python](https://github.com/actions/setup-python/releases).

npm artifact inspection and authorization are separate steps described in
[release preparation](../docs/releasing.md). Tests against synthetic fixtures
are not financial homologation.