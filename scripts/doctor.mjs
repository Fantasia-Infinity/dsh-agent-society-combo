#!/usr/bin/env node
/**
 * Post-install doctor for dsh-agent-society-combo.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const comboRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = homedir()
const root = resolve(
  process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : process.env.COMBO_ROOT || join(home, '.local', 'share', 'dsh-agent-society-combo'),
)
const dshHome = resolve(process.env.DSH_HOME || join(home, '.dsh'))
const binDir = resolve(process.env.COMBO_BIN || join(home, '.local', 'bin'))
const checks = []
let failures = 0

function check(name, ok, detail = '') {
  checks.push(`${ok ? '[ok]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

function file(path) {
  return existsSync(path) ? path : undefined
}

const manifest = JSON.parse(readFileSync(join(comboRoot, 'sources.lock.json'), 'utf8'))
for (const [name, comp] of Object.entries(manifest.components)) {
  const dir = join(root, 'sources', name)
  const state = join(root, 'state', `${name}.json`)
  check(`${name} checkout`, existsSync(join(dir, '.git')), dir)
  check(`${name} state`, existsSync(state), state)
  if (existsSync(dir)) {
    const result = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    const actual = result.stdout.trim()
    check(
      `${name} commit`,
      actual.startsWith(comp.commit) || comp.commit.startsWith(actual),
      `wanted ${comp.commit}, got ${actual || 'unknown'}`,
    )
  }
}

const harness = join(root, 'sources', 'deepseek-harness')
const tui = join(root, 'sources', 'dsh-tui')
const agentSociety = join(root, 'sources', 'agent-society')
check('harness dsh bin', Boolean(file(join(harness, 'apps', 'cli', 'lib', 'bin.js'))))
check('harness app-boot lib', Boolean(file(join(harness, 'packages', 'boot', 'app-boot', 'lib', 'index.js'))))
check('harness web dist', Boolean(file(join(harness, 'apps', 'web', 'dist', 'index.html'))))
check('dsh-tui plugin lib', Boolean(file(join(tui, 'lib', 'types', 'plugin.js'))))
check('agent-host cli', Boolean(file(join(agentSociety, 'agent-host', 'dist', 'src', 'cli.js'))))
check('dsh-plugin lib', Boolean(file(join(agentSociety, 'dsh-plugin', 'lib', 'worker-plugin.js'))))

const pluginLink = join(dshHome, 'plugins', 'agent-society', 'cordis.patch.yml')
check('~/.dsh/plugins/agent-society', existsSync(pluginLink), pluginLink)
const preset = join(dshHome, '.agent-presets', 'anchored-standard', 'preset.yml')
check('anchored-standard preset', existsSync(preset), preset)
const workerProfile = join(dshHome, 'profiles', 'agent-society-worker', 'package.json')
check('agent-society-worker profile', existsSync(workerProfile), workerProfile)
const webProfile = join(dshHome, 'profiles', 'agent-society-web', 'package.json')
check('agent-society-web profile', existsSync(webProfile), webProfile)
const pref = join(home, '.dsh-tui', 'agent-preset.json')
check('dsh-tui default preset', existsSync(pref), pref)

const dshCmd = join(binDir, platform() === 'win32' ? 'dsh.cmd' : 'dsh')
const agentCmd = join(binDir, platform() === 'win32' ? 'agent.cmd' : 'agent')
const webCmd = join(binDir, platform() === 'win32' ? 'dsh-web.cmd' : 'dsh-web')
check('dsh command', existsSync(dshCmd), dshCmd)
check('agent command', existsSync(agentCmd), agentCmd)
check('dsh-web command', existsSync(webCmd), webCmd)

console.log(checks.join('\n'))
console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) failed.`)
  process.exitCode = 1
} else {
  console.log('All combo checks passed.')
}
