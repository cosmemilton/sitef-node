# @cosmemilton/sitef-bridge-win32-x64

Optional platform package for @cosmemilton/sitef. Contains only the owned Rust bridge, not the proprietary CliSiTef SDK. Supply your separately licensed vendor library by absolute path.

Requires Windows x64 and a Windows x64 vendor DLL.

The CommonJS export exposes an absolute executable path. Prefer automatic discovery through createSitef. A manual bridgeExecutable remains supported. See the main project README for configuration, runtime dependencies and validation limits. Synthetic tests are not financial homologation.

Bundled Rust dependencies retain their licenses in THIRD_PARTY_NOTICES.txt.
