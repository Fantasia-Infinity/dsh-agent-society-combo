#!/usr/bin/env node
/**
 * dsh-agent-society-combo installer.
 *
 * One-command bootstrap for the pinned combination:
 * deepseek-harness + dsh-TUI + AgentSociety + dsh-anchored-standard.
 * The installer only manages the files under `--root` plus non-secret links
 * under `$DSH_HOME`; credentials are never copied into this repository.
 */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const comboRoot = resolve(here, '..')
const manifest = JSON.parse(
  readFileSync(join(comboRoot, 'sources.lock.json'), 'utf8'),
)

const args = process.argv.slice(2)
const options = parseArgs(args)
const home = homedir()
const root = resolve(options.root)
const dshHome = resolve(
  process.env.DSH_HOME || join(home, '.dsh'),
)
const binDir = resolve(
  process.env.COMBO_BIN || join(home, '.local', 'bin'),
)
const stateRoot = join(root, 'state')
const sourcesRoot = join(root, 'sources')
const sourceOverrides = new Map()
for (const item of options.source) {
  const separator = item.indexOf('=')
  if (separator < 0) throw new Error(`--source expects name=path, got ${item}`)
  sourceOverrides.set(
    item.slice(0, separator),
    resolve(item.slice(separator + 1)),
  )
}

await main()

function parseArgs(argv) {
  const result = {
    root:
      process.env.COMBO_ROOT ||
      join(homedir(), '.local', 'share', 'dsh-agent-society-combo'),
    preset: process.env.COMBO_PRESET || manifest.defaultPreset,
    source: [],
    patchOnly: false,
    skipDeps: false,
    skipBuild: false,
    skipLinks: false,
    skipConfig: false,
    forceBuild: false,
    dryRun: false,
    yes: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--root') { result.root = next; index += 1 }
    else if (arg.startsWith('--root=')) result.root = arg.slice(7)
    else if (arg === '--preset') { result.preset = next; index += 1 }
    else if (arg.startsWith('--preset=')) result.preset = arg.slice(9)
    else if (arg === '--source') { result.source.push(next); index += 1 }
    else if (arg.startsWith('--source=')) result.source.push(arg.slice(9))
    else if (arg === '--patch-only') result.patchOnly = true
    else if (arg === '--skip-deps') result.skipDeps = true
    else if (arg === '--skip-build') result.skipBuild = true
    else if (arg === '--skip-links') result.skipLinks = true
    else if (arg === '--skip-config') result.skipConfig = true
    else if (arg === '--force-build') result.forceBuild = true
    else if (arg === '--dry-run') result.dryRun = true
    else if (arg === '--yes' || arg === '-y') result.yes = true
    else if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`)
    }
  }
  return result
}

function usage() {
  return `Usage: node scripts/install.mjs [options]

Options:
  --root <dir>        install root (default ~/.local/share/dsh-agent-society-combo)
  --preset <id>       default TUI preset: anchored-standard (default), standard,
                      code, minimal, or cordis
  --source <name>=<path>
                      use an existing checkout instead of cloning
  --patch-only        clone + patch only; no dependency install/build/link
  --skip-deps         do not install npm/pnpm dependencies
  --skip-build        do not build
  --skip-links        do not create ~/.dsh and bin links
  --skip-config       do not write default TUI preferences
  --force-build       rebuild even when build markers exist
  --dry-run           print the plan without changing anything`
}

async function main() {
  if (!manifest.supportedPresets.includes(options.preset)) {
    throw new Error(
      `Unsupported preset "${options.preset}". Supported: ${manifest.supportedPresets.join(', ')}`,
    )
  }
  if (options.dryRun) {
    printPlan()
    return
  }
  console.log(`dsh-agent-society-combo installer (root: ${root})`)
  console.log(`preset: ${options.preset}  dsh-home: ${dshHome}`)

  const components = [
    'deepseek-harness',
    'dsh-tui',
    'agent-society',
    'dsh-anchored-standard',
  ]
  for (const name of components) {
    await installComponent(name)
  }

  if (options.patchOnly) {
    console.log('Patch-only install complete. Use `node scripts/doctor.mjs --root ' + root + '`.')
    return
  }

  const harness = componentDir('deepseek-harness')
  const tui = componentDir('dsh-tui')
  const agentSociety = componentDir('agent-society')

  if (!options.skipDeps) await installDependencies(harness, tui, agentSociety)
  if (!options.skipBuild) await buildAll(harness, tui, agentSociety)
  if (!options.skipLinks) await createLinks(harness, tui, agentSociety)
  if (!options.skipConfig) await writePreferences()

  console.log('')
  console.log('Install complete.')
  console.log('  dsh:      ' + join(binDir, platform() === 'win32' ? 'dsh.cmd' : 'dsh'))
  console.log('  agent:    ' + join(binDir, platform() === 'win32' ? 'agent.cmd' : 'agent'))
  console.log('  dsh-tui:  ' + join(binDir, platform() === 'win32' ? 'dsh-tui.cmd' : 'dsh-tui'))
  console.log('')
  console.log('Next steps:')
  console.log('  1. Make sure "' + binDir + '" is on PATH.')
  console.log('  2. Configure credentials:  cd ' + agentSociety + ' && ./agent setup')
  console.log('  3. Start:                  agent')
}

function printPlan() {
  const names = [
    'deepseek-harness',
    'dsh-tui',
    'agent-society',
    'dsh-anchored-standard',
  ]
  console.log('Plan:')
  for (const name of names) {
    const comp = manifest.components[name]
    console.log(`  clone ${comp.repo} @ ${comp.commit} -> ${componentDir(name)}`)
    for (const patch of comp.patches) console.log(`    apply ${patch.path}`)
  }
  console.log('  link ~/.dsh/plugins/agent-society')
  console.log('  copy ~/.dsh/.agent-presets/anchored-standard')
  console.log('  write ~/.dsh-tui/agent-preset.json = ' + options.preset)
  console.log('  links: dsh, dsh-tui, agent')
}

async function installComponent(name) {
  const comp = manifest.components[name]
  const dir = componentDir(name)
  const stateFile = join(stateRoot, `${name}.json`)
  const desiredState = {
    commit: comp.commit,
    patches: Object.fromEntries(
      comp.patches.map((patch) => [patch.path, patch.sha256]),
    ),
    files: Object.fromEntries(
      comp.files.map((file) => [file.dest, file.sha256]),
    ),
  }
  if (
    existsSync(stateFile) &&
    JSON.stringify(readJson(stateFile)) === JSON.stringify(desiredState) &&
    existsSync(join(dir, '.git'))
  ) {
    console.log(`[ok] ${name} already at ${comp.commit}`)
    return
  }

  if (sourceOverrides.has(name)) {
    console.log(`[use] ${name} <- ${sourceOverrides.get(name)}`)
    ensureDir(dirname(dir))
    linkOrCopy(sourceOverrides.get(name), dir)
  } else {
    console.log(`[clone] ${comp.repo} @ ${comp.commit}`)
    ensureDir(dirname(dir))
    cloneAtCommit(comp.repo, comp.commit, dir)
  }

  if (sourceOverrides.has(name)) {
    console.log(`[skip-patch] ${name} uses --source checkout; not applying patches`)
    return
  }

  const status = runCapture('git', ['status', '--porcelain'], dir, false)
  if (status.status === 0 && status.stdout.trim() !== '') {
    throw new Error(
      `${name}: ${dir} has local changes. Commit or discard them before updating.`,
    )
  }
  runChecked('git', ['reset', '--hard', comp.commit], dir)
  for (const patch of comp.patches) {
    const patchPath = join(comboRoot, patch.path)
    const actual = sha256(patchPath)
    if (actual !== patch.sha256) {
      throw new Error(`${patch.path}: checksum mismatch`)
    }
    runChecked('git', ['apply', '--check', patchPath], dir)
    runChecked('git', ['apply', patchPath], dir)
    console.log(`[patch] ${patch.path}`)
  }
  for (const file of comp.files) {
    const source = join(comboRoot, file.src)
    const target = join(dir, file.dest)
    ensureDir(dirname(target))
    copyFileSync(source, target)
    if (file.executable) chmodSync(target, 0o755)
    console.log(`[file] ${file.dest}`)
  }
  ensureDir(stateRoot)
  writeFileSync(stateFile, `${JSON.stringify(desiredState, null, 2)}\n`)
}

function cloneAtCommit(repo, commit, dir) {
  if (existsSync(join(dir, '.git'))) {
    const status = runCapture('git', ['status', '--porcelain'], dir, false)
    if (status.status !== 0 || status.stdout.trim() !== '') {
      throw new Error(`${dir} is dirty; commit or remove it before updating`)
    }
    runChecked('git', ['fetch', '--quiet', '--depth', '1', 'origin', commit], dir)
    runChecked('git', ['checkout', '--quiet', commit], dir)
    return
  }
  rmSync(dir, { recursive: true, force: true })
  runChecked(
    'git',
    ['clone', '--quiet', '--filter=blob:none', '--no-checkout', repo, dir],
    comboRoot,
  )
  runChecked('git', ['checkout', '--quiet', commit], dir)
}

async function installDependencies(harness, tui, agentSociety) {
  console.log('[deps] deepseek-harness pnpm install')
  if (!existsSync(join(harness, 'node_modules', '.pnpm'))) {
    pnpm(harness, ['install', '--frozen-lockfile'])
  } else {
    console.log('[skip] node_modules already present')
  }

  console.log('[deps] dsh-TUI npm ci')
  if (!existsSync(join(tui, 'node_modules', 'react'))) {
    runChecked('npm', ['ci'], tui)
  } else {
    console.log('[skip] node_modules already present')
  }

  console.log('[deps] AgentSociety agent-host npm ci')
  if (!existsSync(join(agentSociety, 'agent-host', 'node_modules'))) {
    runChecked('npm', ['ci'], join(agentSociety, 'agent-host'))
  } else {
    console.log('[skip] node_modules already present')
  }

  console.log('[deps] AgentSociety dsh-plugin npm ci')
  if (!existsSync(join(agentSociety, 'dsh-plugin', 'node_modules', 'typescript'))) {
    runChecked('npm', ['ci'], join(agentSociety, 'dsh-plugin'))
  } else {
    console.log('[skip] node_modules already present')
  }
}

async function buildAll(harness, tui, agentSociety) {
  const harnessBin = join(harness, 'apps', 'cli', 'lib', 'bin.js')
  const bootLib = join(harness, 'packages', 'boot', 'app-boot', 'lib', 'index.js')
  if (options.forceBuild || !existsSync(harnessBin) || !existsSync(bootLib)) {
    console.log('[build] deepseek-harness build:lib:host')
    pnpm(harness, ['run', 'build:lib:host'])
  } else {
    console.log('[skip] deepseek-harness already built')
  }

  const tuiPlugin = join(tui, 'lib', 'types', 'plugin.js')
  if (options.forceBuild || !existsSync(tuiPlugin)) {
    console.log('[build] dsh-TUI')
    if (platform() === 'win32') {
      const bash = which('bash')
      if (bash) {
        runChecked(bash, ['scripts/build.sh'], tui, {
          DSH_CHECKOUT: harness,
        })
      } else {
        runChecked('npx', ['tsc', '-p', 'tsconfig.json'], tui, {
          DSH_CHECKOUT: harness,
        })
      }
    } else {
      runChecked('/bin/sh', ['scripts/build.sh'], tui, {
        DSH_CHECKOUT: harness,
      })
    }
  } else {
    console.log('[skip] dsh-TUI already built')
  }

  console.log('[build] AgentSociety agent-host')
  runChecked('npm', ['run', 'build'], join(agentSociety, 'agent-host'))

  console.log('[build] AgentSociety dsh-plugin')
  runChecked('npm', ['run', 'build'], join(agentSociety, 'dsh-plugin'))
}

async function createLinks(harness, tui, agentSociety) {
  ensureDir(binDir)
  ensureDir(join(dshHome, 'plugins'))
  ensureDir(join(dshHome, '.agent-presets'))

  const pluginSource = join(agentSociety, 'dsh-plugin')
  const pluginLink = join(dshHome, 'plugins', 'agent-society')
  console.log(`[link] ${pluginLink} -> ${pluginSource}`)
  linkOrCopy(pluginSource, pluginLink)

  const presetSource = join(componentDir('dsh-anchored-standard'))
  const presetDest = join(dshHome, '.agent-presets', 'anchored-standard')
  console.log(`[preset] copy anchored-standard -> ${presetDest}`)
  copyPreset(presetSource, presetDest)

  if (platform() === 'win32') {
    writeCmd('dsh', ['node', join(harness, 'apps', 'cli', 'lib', 'bin.js')])
    writeCmd('dsh-tui', ['node', join(tui, 'bin', 'dsh-tui-local.js')])
    writeCmd(
      'agent',
      ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(agentSociety, 'agent.ps1')],
    )
  } else {
    linkExecutable(join(harness, 'apps', 'cli', 'lib', 'bin.js'), join(binDir, 'dsh'))
    linkExecutable(join(tui, 'bin', 'dsh-tui-local.js'), join(binDir, 'dsh-tui'))
    linkExecutable(join(agentSociety, 'agent'), join(binDir, 'agent'))
  }

  console.log('[profile] agent-society-worker')
  const dshBin = join(binDir, platform() === 'win32' ? 'dsh.cmd' : 'dsh')
  const profile = join(dshHome, 'profiles', 'agent-society-worker')
  if (!existsSync(join(profile, 'package.json'))) {
    const result = runCapture(
      process.execPath,
      [join(harness, 'apps', 'cli', 'lib', 'bin.js'), 'plugin', '--profile', 'agent-society-worker', 'add', pluginSource],
      comboRoot,
      true,
    )
    if (result.status !== 0) {
      console.warn('[warn] dsh plugin profile bootstrap failed; run manually:')
      console.warn(`  ${dshBin} plugin --profile agent-society-worker add ${pluginSource}`)
    }
  } else {
    console.log('[skip] profile already exists')
  }
}

async function writePreferences() {
  const prefsDir = join(home, '.dsh-tui')
  ensureDir(prefsDir)
  const prefs = join(prefsDir, 'agent-preset.json')
  if (!existsSync(prefs)) {
    writeFileSync(prefs, `${JSON.stringify({ preset: options.preset }, null, 2)}\n`)
    console.log(`[config] default preset -> ${options.preset}`)
  } else {
    console.log(`[keep] existing ${prefs}`)
  }
}

function componentDir(name) {
  return join(sourcesRoot, name)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function linkOrCopy(source, target) {
  if (existsSync(target) || isLink(target)) {
    console.log(`[keep] ${target} already exists`)
    return
  }
  ensureDir(dirname(target))
  try {
    symlinkSync(source, target, platform() === 'win32' ? 'junction' : 'dir')
  } catch {
    cpSync(source, target, { recursive: true, dereference: true })
  }
}

function linkExecutable(source, target) {
  if (existsSync(target) || isLink(target)) {
    console.log(`[keep] ${target} already exists`)
    return
  }
  try {
    symlinkSync(source, target, 'file')
  } catch {
    copyFileSync(source, target)
    chmodSync(target, 0o755)
  }
}

function writeCmd(name, command) {
  const target = join(binDir, `${name}.cmd`)
  if (existsSync(target)) {
    console.log(`[keep] ${target} already exists`)
    return
  }
  const args = command.slice(1).map(quoteCmd).join(' ')
  writeFileSync(target, `@echo off\r\n"${quoteCmd(command[0])}" ${args} %*\r\n`)
}

function quoteCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function copyPreset(source, dest) {
  const required = [
    'agent.cordis.yml',
    'preset.yml',
    'tool-bootstrap.mjs',
    'dev-tool-search.mjs',
    'skill-search.mjs',
    'instruction-hint.mjs',
    'compaction-epoch.mjs',
    'custom-bash.mjs',
  ]
  rmSync(dest, { recursive: true, force: true })
  ensureDir(dest)
  for (const name of required) {
    const src = join(source, name)
    if (!existsSync(src)) throw new Error(`preset file missing: ${src}`)
    copyFileSync(src, join(dest, name))
  }
}

function pnpm(cwd, args) {
  const pnpmBin = which('pnpm')
  if (pnpmBin) {
    runChecked(pnpmBin, args, cwd)
    return
  }
  const corepack = which('corepack')
  if (corepack) {
    runChecked(corepack, ['pnpm@11.7.0', ...args], cwd)
    return
  }
  throw new Error('pnpm 11.7.0 is required; install pnpm or enable corepack')
}

function which(name) {
  const result = runCapture(
    platform() === 'win32' ? 'where' : 'which',
    [name],
    comboRoot,
    true,
  )
  if (result.status !== 0) return undefined
  return result.stdout.trim().split(/\r?\n/u)[0] || undefined
}

function runChecked(command, args, cwd, env = {}) {
  const result = runCapture(command, args, cwd, true, env)
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd} (status=${result.status}, signal=${result.signal}, error=${result.error ? result.error.message : 'none'})\n${result.stdout}\n${result.stderr}`,
    )
  }
}

function runCapture(command, args, cwd, inherit, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell: platform() === 'win32' && command.endsWith('.cmd'),
  })
  return result
}

function isLink(path) {
  try {
    return statSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
