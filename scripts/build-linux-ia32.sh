#!/bin/sh
# Prerequisites: rustup target add i686-unknown-linux-gnu; gcc-multilib.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export CARGO_TARGET_I686_UNKNOWN_LINUX_GNU_LINKER="${CARGO_TARGET_I686_UNKNOWN_LINUX_GNU_LINKER:-$ROOT/scripts/link-linux-ia32.sh}"
# Cargo's encoded form preserves path arguments containing spaces.
SEP=$(printf '\037')
BASE_FLAGS=${CARGO_ENCODED_RUSTFLAGS:-$(printf '%s' "${RUSTFLAGS:-}" | tr '[:space:]' '\037')}
export CARGO_ENCODED_RUSTFLAGS="$BASE_FLAGS${BASE_FLAGS:+$SEP}--remap-path-prefix=$ROOT=/sitef-node${SEP}--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
cargo build --locked --manifest-path "$ROOT/native/Cargo.toml" --release --target i686-unknown-linux-gnu
