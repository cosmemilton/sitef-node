# CI template

`github-actions.yml` is an inactive template. Copy it to
`.github/workflows/check.yml` to enable repository CI. Publishing the template
does not enable Actions or require workflow-file write permission from the
publishing connector.

The Linux job tests owned TypeScript/Rust/C contracts and the generated catalog;
it does not claim a Linux vendor runtime. The Windows job compiles the production
x64 helper without loading a vendor DLL. Neither job performs financial operations,
uses vendor credentials or downloads proprietary libraries. No npm/PyPI/Packagist
publication, release upload or deployment is configured.

The template expects the committed npm lockfile and public development/peer
dependencies to be installable. It has not been executed by GitHub Actions in
this project; local checks are recorded separately in the validation documents.

The action major versions were checked against their maintainers' primary
documentation: [checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node), and
[setup-python](https://github.com/actions/setup-python).
