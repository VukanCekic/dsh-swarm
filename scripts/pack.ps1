<#
.SYNOPSIS
  Pack dsh-swarm into <OutDir>/dsh-swarm-<version>.tgz (default: ./dist).
.EXAMPLE
  ./scripts/pack.ps1
  ./scripts/pack.ps1 -OutDir ./build
.NOTES
  Install with DeepSeek Harness closed:
    $env:DSH_HOME = '<path-to-your-dsh-home>'   # optional if using the default
    dsh plugin --profile desktop add "file:<path-to-tgz>"
  pnpm may exit 1 with ERR_PNPM_IGNORED_BUILDS (e.g. @google/genai, protobufjs);
  that is harmless and the plugin copy is still installed.
  Always install from the .tgz rather than a symlink/link install.
#>
param(
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$outDirAbs = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $outDirAbs | Out-Null

$out = Join-Path $outDirAbs "$($pkg.name)-$($pkg.version).tgz"
$stage = Join-Path $outDirAbs '.pack-stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }

try {
  $pkgDir = Join-Path $stage 'package'
  New-Item -ItemType Directory -Force -Path (Join-Path $pkgDir 'lib') | Out-Null
  Copy-Item (Join-Path $root 'package.json'), (Join-Path $root 'cordis.patch.yml'), (Join-Path $root 'README.md'), (Join-Path $root 'LICENSE') $pkgDir
  Copy-Item (Join-Path $root 'lib\index.js'), (Join-Path $root 'lib\client.js') (Join-Path $pkgDir 'lib')
  Push-Location $stage
  try {
    # Relative path only: GNU tar (e.g. Git's, if first on PATH) reads "D:\..." as a remote host.
    tar -czf (Join-Path '..' (Split-Path $out -Leaf)) package
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
}

"packed $out"
