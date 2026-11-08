#!/usr/bin/env python3
"""Generate notices from the exact locked Cargo graph, including build/target-only crates.
Prerequisites: cargo fetch --locked --manifest-path native/Cargo.toml;
rustup component add rust-docs (use the same RUSTUP_TOOLCHAIN as the build).
"""
import json
from html.parser import HTMLParser
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent.parent
metadata = json.loads(subprocess.check_output([
    'cargo', 'metadata', '--offline', '--locked', '--format-version', '1',
    '--manifest-path', str(root / 'native/Cargo.toml')
], text=True))
parts = ['THIRD-PARTY NOTICES\n\nThe bridge includes open-source Rust dependencies. The following notices are copied from the locked crate sources. Only trailing whitespace and final blank lines are normalized; license wording is unchanged. This conservative list includes build-time and target-specific crates, not only linked code. CliSiTef and other proprietary vendor libraries are not included.\n']
for package in sorted(metadata['packages'], key=lambda p: p['name']):
    if package['name'] == 'sitef-bridge':
        continue
    directory = Path(package['manifest_path']).parent
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'copying', 'copyright', 'notice')))
    if not files:
        raise SystemExit('No license notice found for ' + package['name'])
    parts.append('\n' + '=' * 72 + '\n' + package['name'] + ' ' + package['version'] + '\nLicense expression: ' + package.get('license', 'see license text') + '\n')
    for file in files:
        parts.append('\n--- ' + file.name + ' ---\n' + file.read_text(encoding='utf-8'))
sysroot = Path(subprocess.check_output(['rustc', '--print', 'sysroot'], text=True).strip())
standard = sysroot / 'share/doc/rust/COPYRIGHT-library.html'
if not standard.is_file():
    raise SystemExit('Install rust-docs for the build toolchain to collect standard-library notices')
class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
parser = PlainText(); parser.feed(standard.read_text(encoding='utf-8'))
parts.append('\nRust standard library notices (' + subprocess.check_output(['rustc', '--version'], text=True).strip() + ')\nSource: toolchain COPYRIGHT-library.html\n' + ''.join(parser.parts))
text = '\n'.join(line.rstrip() for line in '\n'.join(parts).splitlines()).rstrip() + '\n'
for target in ('linux-ia32', 'win32-x64'):
    (root / 'packages' / ('bridge-' + target) / 'THIRD_PARTY_NOTICES.txt').write_text(text, encoding='utf-8', newline='\n')
print('Generated notices for', len(metadata['packages']) - 1, 'locked dependencies')
