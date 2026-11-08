# Native host

Rust executable using JSON lines on stdin/stdout. Supported vendor ABI targets
are **Windows x64** and **Linux i686 (32-bit, glibc)**, in a process isolated from
Node/Electron. A Linux x64 Node/Electron process launches the i686 executable;
the helper architecture must match the vendor library, not the parent process.

The integrator supplies an absolute path to its own library: on Windows use the
**interface** DLL (e.g. `CliSiTef64I.dll`), never the internal `CliSiTef.dll`.
PE headers must identify AMD64 PE32+. On Linux use `libclisitef.so` from the Linux32
kit. ELF headers must identify a little-endian Intel 386 ELF32 shared object.
No vendor library, configuration, certificate or manual is included.

Stdio remains the default. An optional authenticated loopback transport is
available for clients such as PHP on Windows:
`--connect 127.0.0.1:PORT --token-env SITEF_BRIDGE_TOKEN`. The client creates the
listener first and supplies a fresh 64-hex-character nonce in the child
environment. The helper removes it, connects within 10 seconds, and sends
`{protocolVersion:1,transport:"tcp-loopback",token:nonce}` before the same NDJSON
requests/replies. Only the exact IPv4 loopback address and a nonzero port are
accepted. TCP mode leaves stdout/stderr empty. See [the shared protocol](../docs/bridge-protocol.md) for
the full language-neutral contract and error/state semantics.

Other host architectures, including Linux x64 bridges, remain synthetic-test only
with explicit `testMode: true`. Never use testMode to bypass vendor ABI checks.
Linux i686 has `sizeof(long) == 4`; Linux x64 has `sizeof(long) == 8` and cannot
safely substitute for the supplied Linux32 library. The C ABI is used on Linux.

The original semantic baseline is VRS-258 and Wallets 1.43 from the Win32 kit.
Later checks compared the 444 field IDs in section 5.3.2 with VRS-260; specific guides cite additional targeted consultations. This is not a
complete semantic audit of VRS-260. PDFs in the x64 kit were not read or used.
The supplied x64 binary is older than those documents. Capabilities therefore
report the symbols actually present, and optional wrappers fail explicitly when
an entrypoint is missing; newer documented features still require vendor tests.

On WSL with an installed Visual Studio C++ x64 toolchain and Windows SDK, run
`rustup target add x86_64-pc-windows-msvc` once, then
`bash scripts/build-windows-x64.sh` from the project root. The script uses Rust's
bundled `rust-lld` and existing Windows import libraries, with static CRT. Set
`SITEF_MSVC_LIB_DIR`, `SITEF_UCRT_LIB_DIR`, and `SITEF_WINDOWS_UM_LIB_DIR` to override
auto-detected x64 library folders; `SITEF_PROGRAMFILES_X86` overrides the default
WSL mount `/mnt/c/Program Files (x86)`. It downloads no vendor library and copies
no compiler libraries into packages. Missing Microsoft PDB warnings affect debug
information only and do not establish runtime failure.

For a native Windows release build, run the following in PowerShell at the
repository root after installing the Rust target, MSVC and Windows SDK:

```powershell
$repo = (Resolve-Path .).Path
$env:CARGO_ENCODED_RUSTFLAGS = @(
  '-Ctarget-feature=+crt-static'
  "--remap-path-prefix=$repo=/sitef"
  "--remap-path-prefix=$env:USERPROFILE=/build-home"
) -join [char]31
cargo build --locked --release --target x86_64-pc-windows-msvc --manifest-path native/Cargo.toml
```

The ASCII 31 separator preserves paths containing spaces. These flags use the
static CRT and remap repository/profile paths so the executable does not expose
personal build directories. Add another remap for a custom CARGO_HOME outside
those roots. The packaging guard rejects embedded personal paths; a plain cargo
release build without remapping may therefore be unsuitable for distribution.
The WSL Windows build script and Linux build script apply remapping themselves.
Stage only a freshly built artifact for the intended target.


`load` parameters:

```json
{"id":1,"method":"load","params":{"libraryPath":"C:\\vendor\\CliSiTef64I.dll","nativeEncoding":"windows-1252"}}
```

Optional `workingDirectory` must be absolute, defaults to the library directory,
and is set only inside the helper process. `nativeEncoding` accepts
`windows-1252` (initial explicit default), `utf-8`, or `ascii`. Actual vendor
encoding must be checked in simulator tests before production. Input encoding
loss and embedded NUL are rejected. Returned native data retains original base64
bytes and an explicit `decodingError` marker; malformed native text never silently
replaces the financial status. `continue.bufferBase64` bypasses text encoding;
the response field has the same name.

`load` and `capabilities` return:

```json
{
  "protocolVersion": 1,
  "bridgeVersion": "0.1.0",
  "platform": "windows",
  "architecture": "x86_64",
  "runtimeTarget": "windows-x64",
  "nativeEncoding": "windows-1252",
  "fieldTypeBytes": 4,
  "testMode": false,
  "minimumBufferSize": 20000,
  "functions": {
    "start": {"symbol": "IniciaFuncaoSiTefInterativo", "available": true, "callable": true}
  }
}
```

Errors have `{id,error:{code,message}}`; native returns keep their original
numbers in `result`, with no context-free success/denial mapping. Error messages
never interpolate native buffers, collection results, or native loader paths.
The process loads one library for its lifetime and serializes all calls.

Methods implemented:

| Method | Parameters | Result |
| --- | --- | --- |
| configure | server, storeId, terminalId, reserved=0, additionalParameters | status |
| start | functionId, amount, fiscalDocument, fiscalDate, fiscalTime, operator, additionalParameters | status |
| continue | buffer, bufferBase64?, continueFlag, bufferSize (20000–1048576) | status, command, fieldType, minLength, maxLength, buffer, bufferBase64, decodingError |
| finish | confirm (0 or 1), fiscalDocument, fiscalDate, fiscalTime, additionalParameters | returned:true (native void) |
| version | none | status, libraryVersion, interfaceVersion |
| pendingCount | fiscalDate, fiscalDocument | count, status (same native return) |
| flushMessages | none | status |
| pinpadPresent / pinpadKeepAlive / pinpadKey | none | status |
| pinpadPermanentMessage / pinpadMessage / pinpadYesNo | message | status |
| pinpadInfo | none | UNVERIFIED_OUTPUT_BOUND; use start functionId 775 |
| validateBarcode | data | status, documentType |
| removeCard | none | status |
| startBanking | fiscalDocument, fiscalDate, fiscalTime, operator, additionalParameters | status |
| readSecureCard / readTrack3 | message | status (then continue loop) |
| readPassword | securityKey (exactly 64 native bytes) | status (then continue loop) |
| readPasswordDirect | securityKey (exactly 64 native bytes) | status, encryptedPassword |
| readChip | modality, additionalParameters | status (then continue loop) |

Version output strings are objects `{text,rawBase64,decodingError}`. In
capabilities, `available` reports an exported symbol and `callable` additionally
requires an enabled callable wrapper. `configureEx` and `readChipEx` describe
export variants, not separate methods: their `invocationMethod` values point to
`configure` and `readChip`, which select the extended export when present. These
two metadata variants have `callable:false`. `pinpadInfo` is blocked because its direct
ABI has no capacity argument and the manual states a minimum allocation without
a verified maximum output bound. Function 775 uses bounded continuation instead.
`readPassword` is a proprietary store-card function, not a way to collect payment
card PINs; encrypted material must never enter logs or generic UI inputs.

Continuation retains native command/type/size outputs across calls as VRS-258
requires. The first call starts with zeroed outputs. The caller must echo the
original bytes for command 0 and provide collection responses for other commands.
`AbortSignal`, a timeout, a process exit, and a closed modal do not establish a
financial cancellation. Send `continueFlag:-1` and process the terminal result.
There is no automatic retry, confirmation, reversal, or journal in this low-level
host; the SDK/integrator owns durable decisions and recovery.

Explicit coverage gaps pending verification: direct secure-card/track
entrypoints with native callbacks and ASCII-interface variants are not exposed
as generic arbitrary FFI. They require verified signatures, cancellation and
bounded buffer tests. All standard transaction modalities remain accessible via
`start.functionId`, including secure-reader modalities 430/431, and unrestricted
raw `additionalParameters`. The initial helper must not be described as complete
coverage or homologated until these gaps and vendor simulator tests are closed.

Run own-contract tests using `cargo test` and `python3 tests/smoke.py`. The latter
compiles an original synthetic C shared library and tests actual process IPC;
it never loads vendor binaries.
`python3 tests/smoke_tcp.py` additionally verifies the opt-in socket handshake,
nonce removal before FFI, and the same loop against our own synthetic fixture.

## Linux build and runtime

On a glibc Linux development host, install the Rust target
`rustup target add i686-unknown-linux-gnu` and the distribution's GCC multilib
development package (Debian/Ubuntu: `gcc-multilib`). Then run
`bash scripts/build-linux-ia32.sh` from the repository root. The output is
`native/target/i686-unknown-linux-gnu/release/sitef-bridge`.
`SITEF_LINUX_SYSROOT` optionally selects an existing local multilib sysroot;
the build does not download or bundle a runtime and embeds no sysroot rpath.

Deployment requires a kernel capable of running i386 executables, the 32-bit
glibc loader (`/lib/ld-linux.so.2`), libc/libgcc and any 32-bit dependencies
required by the integrator's vendor kit. On Debian/Ubuntu these typically
include `libc6-i386` and `lib32gcc-s1`; inspect the particular kit's dependencies.
Build against the oldest glibc baseline you intend to support, and verify
`readelf --version-info` on the executable. A build on a newer distro is not
automatically compatible with older glibc. Alpine/musl and Linux ARM are not
supported by these artifacts. System installation and USB access are separate
integrator setup steps, not performed by the package.

The vendor may depend on companion libraries beside `libclisitef.so`.
Set `LD_LIBRARY_PATH` in the **helper's startup environment** to the trusted
vendor directory and required 32-bit runtime directories, using the SDK bridge
environment option or a manual wrapper. Changing workingDirectory alone does
not change Linux dynamic-loader search paths. Do not add untrusted directories
or an empty path component. The user must separately supply INI/certificates
and configure the real Linux pinpad device. Windows COM names are not Linux
device paths. Never attach USB, alter device permissions or run payments as an
installation test.

Linux capabilities report `platform: "linux"`, `architecture: "x86"`,
`runtimeTarget: "linux-ia32"`, `fieldTypeBytes: 4`. Linux support is not vendor
homologation. Earlier local simulator communication tests do not establish
pinpad, payment, cancellation or reconciliation coverage.

For full own-contract IPC smoke coverage in an i686 process:
`SITEF_SMOKE_TARGET=i686-unknown-linux-gnu SITEF_SMOKE_CC="gcc -m32" python3 native/tests/smoke.py`.
This loads an original synthetic ELF32 fixture with the real i686 load guard
(testMode false), not a vendor library. `SITEF_SMOKE_RUNNER` may specify a local
32-bit loader for a user-provisioned sysroot. Standard host smoke tests continue
to use testMode true. Neither proves the vendor's complete ABI.

## Distribution

Platform-specific npm packages contain only the original bridge executable and
metadata/licenses. Proprietary runtime files must be provisioned separately.
Manual `bridgeExecutable` paths remain supported. The bridge's own version is
independent of the npm version; the protocol handshake and actual capabilities
remain authoritative. Package builds do not imply publication, financial
homologation, or a supported Linux64 vendor library. See
[release preparation](../docs/releasing.md).

## License

The original Rust bridge code is licensed under [MIT](../LICENSE), copyright
2026 cosmemilton. Dependencies retain their own licenses. This license does not
grant rights to the proprietary CliSiTef SDK, DLLs, configuration files,
certificates or manuals. Obtain those separately through an authorized integrator.
