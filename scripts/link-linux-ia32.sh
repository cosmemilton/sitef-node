#!/bin/sh
# GCC multilib linker; no private sysroot path or rpath is embedded in artifacts.
set -eu
if [ -n "${SITEF_LINUX_SYSROOT:-}" ]; then
  exec gcc -m32 --sysroot="$SITEF_LINUX_SYSROOT" -B"$SITEF_LINUX_SYSROOT/usr/lib32/" -B"$SITEF_LINUX_SYSROOT/usr/lib/gcc/x86_64-linux-gnu/13/32/" -L"$SITEF_LINUX_SYSROOT/usr/lib32" -L"$SITEF_LINUX_SYSROOT/usr/lib/gcc/x86_64-linux-gnu/13/32" "$@"
fi
exec gcc -m32 "$@"
