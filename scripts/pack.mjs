#!/usr/bin/env node
// Pack dsh-swarm into <outDir>/dsh-swarm-<version>.tgz (default: ./dist).
// Usage: node scripts/pack.mjs [outDir]
//
// Install (with DeepSeek Harness closed):
//   dsh plugin --profile <profile> add file:<absolute-path-to-tgz>
// Always install from the .tgz (a real copy): a link install cannot resolve
// @deepseek-ai/* and `pnpm remove` follows symlinks.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outDir = path.resolve(process.argv[2] || path.join(root, 'dist'))
const outFile = path.join(outDir, `${pkg.name}-${pkg.version}.tgz`)
const stage = path.join(outDir, '.pack-stage')
const pkgDir = path.join(stage, 'package')

const files = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'lib/index.js',
  'lib/client.js',
]

mkdirSync(outDir, { recursive: true })
rmSync(stage, { recursive: true, force: true })

try {
  mkdirSync(path.join(pkgDir, 'lib'), { recursive: true })
  for (const rel of files) {
    copyFileSync(path.join(root, rel), path.join(pkgDir, rel))
  }
  // Relative paths only: GNU tar (e.g. Git Bash) reads "D:\..." as a remote host.
  execFileSync('tar', ['-czf', path.relative(stage, outFile), 'package'], { cwd: stage, stdio: 'inherit' })
} finally {
  rmSync(stage, { recursive: true, force: true })
}

console.log(`packed ${outFile}`)
