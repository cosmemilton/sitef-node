# Continuous integration

The canonical workflow is [check.yml](../.github/workflows/check.yml), with a matching reference copy in this directory. It is prepared locally and runs on push, pull request or manual dispatch only after these changes are committed and pushed. No remote CI execution is claimed.

The Linux job tests owned TypeScript/Rust/C contracts and the generated catalog,
then runs `npm run pack:check` to inspect package contents without publishing.
It does not provide a proprietary vendor runtime. A separate Ubuntu 22.04 job builds the owned i686 Linux bridge with a multilib toolchain. The Windows job runs `npm ci` and
`npm run check`, then compiles the production x64 helper without loading a vendor DLL. Neither job performs
financial operations, uses vendor credentials or downloads proprietary libraries.
Both native jobs stage and pack their platform subproject and upload the generated npm tarball as a GitHub Actions artifact. No npm publication, GitHub Release publication or deployment is configured.

The template expects the committed npm lockfile and development/peer dependencies
to be installable. This workflow has not been executed by GitHub Actions in this
project. Its presence does not establish a successful CI run. Check the
Actions result for the exact commit before reporting CI success; local checks
are separate and historical results are identified in the validation documents.

The template pins actions to commit SHAs corresponding to the verified v7.0.0
tags. Review the upstream releases before enabling
or updating it: [checkout](https://github.com/actions/checkout/releases),
[setup-node](https://github.com/actions/setup-node/releases), [upload-artifact](https://github.com/actions/upload-artifact/releases), and
[setup-python](https://github.com/actions/setup-python/releases).

npm artifact inspection and authorization are separate steps described in
[release preparation](../docs/releasing.md). Tests against synthetic fixtures
are not financial homologation.
Platform packages are intentionally independent subprojects, not npm workspaces: a workspace with a foreign os/cpu constraint causes npm EBADPLATFORM. Core declares them as optional dependencies. Runtime libraries are never copied into artifacts. The Linux binary targets glibc, not musl; validate its minimum GLIBC requirements against each supported distribution before release.
