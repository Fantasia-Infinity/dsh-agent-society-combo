#!/usr/bin/env node
/**
 * Launch the sibling dsh-TUI checkout against the sibling DeepSeek Harness
 * checkout. This source launcher never bootstraps an npm profile.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const tuiRoot = resolve(here, '..')
const checkout = resolve(process.env.DSH_CHECKOUT ?? resolve(tuiRoot, '../deepseek-harness'))

if (!existsSync(join(checkout, 'apps/cli/package.json'))) {
  console.error(`[dsh-tui] local DeepSeek Harness checkout not found: ${checkout}`)
  console.error('[dsh-tui] Set DSH_CHECKOUT to /path/to/deepseek-harness.')
  process.exit(1)
}

const args = []
for (const arg of process.argv.slice(2)) {
  if (arg === '--resume') {
    let sessionId = ''
    for (const dir of ['.dsh-tui', '.dsh-cc']) {
      try {
        sessionId = readFileSync(join(homedir(), dir, 'resume.txt'), 'utf8').trim()
        if (sessionId) break
      } catch {
        // No resume marker is a normal cold-start case.
      }
    }
    if (sessionId) process.env.DSH_TUI_RESUME_SESSION = sessionId
  } else {
    args.push(arg)
  }
}

process.env.DSH_CHECKOUT ??= checkout
process.env.DSH_HOME ??= join(homedir(), '.dsh')

const child = spawn(process.execPath, ['--import', 'tsx/esm', 'scripts/run.ts', ...args], {
  cwd: tuiRoot,
  env: process.env,
  stdio: 'inherit',
})

child.on('error', error => {
  console.error(`[dsh-tui] failed to launch local source: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
