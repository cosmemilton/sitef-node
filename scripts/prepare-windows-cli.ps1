param(
  [string]$Kit = (Join-Path $env:USERPROFILE 'Downloads\SDK+-+Agente+CliSiTef+Windows.zip'),
  [string]$Bridge = (Join-Path $PSScriptRoot '..\native\target\x86_64-pc-windows-msvc\release\sitef-bridge.exe')
)
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$root = Join-Path $env:USERPROFILE 'Documents\SiTefDevelopment'
$runtime = Join-Path $root 'runtime\7.0.117.123.r2-win64'
if (!(Test-Path -LiteralPath $Bridge)) { throw 'Compile primeiro a ponte Windows x64 (scripts/build-windows-x64.sh no WSL).' }
if (!(Test-Path -LiteralPath (Join-Path $source 'packages\core\dist\index.js'))) { throw 'Execute npm run build antes.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Kit))
$memory = [IO.MemoryStream]::new()
$nested = $null
try {
  $entry = @($archive.Entries | Where-Object FullName -Match 'agenteCliSiTef-1\.0\.0\.17\.r1-Simulado-Win64\.zip$')
  if ($entry.Count -ne 1) { throw 'Kit simulado Win64 esperado nao encontrado.' }
  $stream = $entry[0].Open()
  try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
  $memory.Position = 0
  $nested = [IO.Compression.ZipArchive]::new($memory)
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $allowed = @('CliSiTef64I.dll','libcurl64.dll','libemv64.dll','QREncode64.dll','CliSiTef.ini',
    'LEIAME.TXT','RELEASE.TXT','Cheque.txt','lgpl-2.1.txt','libcurl_LICENSE.txt','libpng_LICENSE.txt','libqrencode_LICENSE.txt')
  foreach ($name in $allowed) {
    $file = @($nested.Entries | Where-Object { $_.Name -ceq $name -and $_.FullName -match '/bin/' })
    if ($file.Count -ne 1) { throw "Arquivo esperado ausente: $name" }
    $destination = Join-Path $runtime $name
    if (Test-Path -LiteralPath $destination) {
      $hash = [Security.Cryptography.SHA256]::Create()
      $stream = $file[0].Open()
      try { $expected = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','') }
      finally { $stream.Dispose(); $hash.Dispose() }
      if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expected) {
        throw "Arquivo local diferente; nao foi sobrescrito: $destination"
      }
    } else {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($file[0], $destination)
    }
  }
} finally {
  if ($nested) { $nested.Dispose() }
  $memory.Dispose()
  $archive.Dispose()
}
$app = Join-Path $root 'cli'
foreach ($directory in @('examples\cli','packages\core\dist')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $app $directory) | Out-Null
}
Copy-Item -LiteralPath $Bridge -Destination (Join-Path $root 'sitef-bridge.exe')
Copy-Item -LiteralPath (Join-Path $source 'examples\windows-cli.mjs') -Destination (Join-Path $app 'examples\windows-cli.mjs')
Copy-Item -LiteralPath (Join-Path $source 'examples\windows-reconcile.mjs') -Destination (Join-Path $app 'examples\windows-reconcile.mjs')
# The reference can contain integrator configuration; preserve an existing local copy.
$simple = Join-Path $app 'examples\windows-simple.mjs'
if (!(Test-Path -LiteralPath $simple)) {
  Copy-Item -LiteralPath (Join-Path $source 'examples\windows-simple.mjs') -Destination $simple
} else {
  Write-Output "Exemplo simples local preservado: $simple"
}
Copy-Item -Path (Join-Path $source 'examples\cli\*.mjs') -Destination (Join-Path $app 'examples\cli')
Copy-Item -Path (Join-Path $source 'packages\core\dist\*') -Destination (Join-Path $app 'packages\core\dist') -Recurse -Force
[IO.File]::WriteAllText((Join-Path $app 'package.json'), '{"private":true,"type":"module"}', [Text.UTF8Encoding]::new($false))
$launcher = "@echo off" + [char]13 + [char]10 +
  'node "%~dp0cli\examples\windows-cli.mjs" %*' + [char]13 + [char]10 +
  'exit /b %errorlevel%' + [char]13 + [char]10
[IO.File]::WriteAllText((Join-Path $root 'sitef-cli.cmd'), $launcher, [Text.ASCIIEncoding]::new())
Write-Output "CLI preparada: $root\sitef-cli.cmd"
Write-Output 'Nenhum Agente, servico, certificado ou configuracao global foi instalado.'
Write-Output 'Execute sitef-cli.cmd --diagnostico ou sitef-cli.cmd em um terminal Windows.'
