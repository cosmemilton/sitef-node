# @cosmemilton/sitef-bridge-linux-ia32

Optional platform package for @cosmemilton/sitef. Contains only the owned Rust bridge, not the proprietary CliSiTef SDK. Supply your separately licensed vendor library by absolute path.

Runs an i686/ELF32 process on Linux glibc x64 or ia32 hosts. Node/Electron may remain x64. The vendor library must be 32-bit. Install the 32-bit loader and dependencies required by your SDK; this package does not install system libraries. Alpine/musl and ARM are not supported.

The CommonJS export exposes an absolute executable path. Prefer automatic discovery through createSitef. A manual bridgeExecutable remains supported. See the main project README for configuration, runtime dependencies and validation limits. Synthetic tests are not financial homologation.

Bundled Rust dependencies retain their licenses in THIRD_PARTY_NOTICES.txt.
