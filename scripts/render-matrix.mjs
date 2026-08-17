#!/usr/bin/env node
/**
 * Keep the README version matrix in sync with sources.lock.json.
 *
 * Usage:
 *   node scripts/render-matrix.mjs            # rewrite README.md
 *   node scripts/render-matrix.mjs --check    # exit 1 if README.md is stale
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(repoRoot, 'sources.lock.json'), 'utf8'))
const readmePath = join(repoRoot, 'README.md')
const readme = readFileSync(readmePath, 'utf8')

const LABELS = {
  'deepseek-harness': 'deepseek-harness',
  'dsh-tui': 'dsh-TUI',
  'agent-society': 'AgentSociety',
  'dsh-anchored-standard': 'dsh-anchored-standard',
  'dsh-opencode-full': 'dsh-opencode-full（可选）',
}

const rows = Object.entries(lock.components).map(([name, comp]) => {
  const label = LABELS[name] ?? name
  return `| ${label} | \`${comp.commit}\` |`
}).join('\n')

const table = `| 组件 | 固定 commit |
|---|---|
${rows}
`

const startMarker = '| 组件 | 固定 commit |'
const start = readme.indexOf(startMarker)
if (start === -1) throw new Error('README.md version matrix start not found')
const afterStart = readme.indexOf('\n', start) + 1
// The table ends at the first line that is not a table row; anything after
// it (explanatory paragraphs) must be preserved.
let tableEnd = afterStart
for (;;) {
  const lineEnd = readme.indexOf('\n', tableEnd)
  const line = readme.slice(tableEnd, lineEnd === -1 ? readme.length : lineEnd)
  if (!line.startsWith('|')) break
  tableEnd = lineEnd + 1
}
const generated = `${readme.slice(0, start)}${table}${readme.slice(tableEnd)}`

if (process.argv.includes('--check')) {
  if (generated !== readme) {
    process.stderr.write('README.md version matrix is out of date; run node scripts/render-matrix.mjs\n')
    process.exit(1)
  }
  process.stdout.write('README.md version matrix is in sync with sources.lock.json\n')
} else {
  writeFileSync(readmePath, generated)
  process.stdout.write(`wrote ${readmePath}\n`)
}
