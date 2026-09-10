#!/usr/bin/env node
/**
 * dsh-agent-society-combo installer.
 *
 * dsh-first AgentSociety installer.
 *
 * The default path consumes the published dsh and AgentSociety packages. The
 * explicit `--source` path keeps the old locked checkout workflow for source
 * development and upstream adaptation. Credentials are never copied into
 * this repository.
 */

import {
  accessSync,
  chmodSync,
  copyFileSync,
  cpSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const comboRoot = resolve(here, '..')
const manifest = JSON.parse(
  readFileSync(join(comboRoot, 'sources.lock.json'), 'utf8'),
)
const published = manifest.published || {}
const publishedDsh = published.dsh || {}
const publishedPlugin = published.agentSocietyPlugin || {}

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
    mode: process.env.COMBO_MODE || 'npm',
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
    update: false,
    withSsh: false,
    sshPlugin: process.env.COMBO_SSH_PLUGIN || 'dsh-ssh-ops@0.2.1',
    withOpenCodeFull: process.env.COMBO_OPENCODE_FULL === '1',
    withSubscriptions: process.env.COMBO_SUBSCRIPTIONS === '1',
    withHost: process.env.COMBO_WITH_HOST === '1',
    withHostExplicit: process.env.COMBO_WITH_HOST === '1',
    dshPackage: process.env.COMBO_DSH_PACKAGE || publishedDsh.package || '@deepseek-ai/dsh',
    dshVersion: process.env.COMBO_DSH_VERSION || publishedDsh.version || '0.1.5-rc.1',
    pluginSpec: process.env.COMBO_AGENT_PLUGIN || publishedPlugin.package || '@agent-society/dsh-agent-society',
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
    else if (arg === '--source') {
      if (next && !next.startsWith('--') && next.includes('=')) {
        result.source.push(next)
        result.mode = 'source'
        index += 1
      } else {
        result.mode = 'source'
      }
    }
    else if (arg.startsWith('--source=')) {
      result.source.push(arg.slice(9))
      result.mode = 'source'
    }
    else if (arg === '--mode') { result.mode = next; index += 1 }
    else if (arg.startsWith('--mode=')) result.mode = arg.slice(7)
    else if (arg === '--patch-only') result.patchOnly = true
    else if (arg === '--skip-deps') result.skipDeps = true
    else if (arg === '--skip-build') result.skipBuild = true
    else if (arg === '--skip-links') result.skipLinks = true
    else if (arg === '--skip-config') result.skipConfig = true
    else if (arg === '--force-build') result.forceBuild = true
    else if (arg === '--update') result.update = true
    else if (arg === '--with-ssh') { result.withSsh = true; if (next && !next.startsWith('--')) { result.sshPlugin = next; index += 1 } }
    else if (arg.startsWith('--with-ssh=')) { result.withSsh = true; result.sshPlugin = arg.slice(11) }
    else if (arg === '--with-opencode-full') result.withOpenCodeFull = true
    else if (arg === '--with-subscriptions') result.withSubscriptions = true
    else if (arg === '--with-host') { result.withHost = true; result.withHostExplicit = true }
    else if (arg === '--without-host') { result.withHost = false; result.withHostExplicit = true }
    else if (arg === '--dsh-package') { result.dshPackage = next; index += 1 }
    else if (arg.startsWith('--dsh-package=')) result.dshPackage = arg.slice(14)
    else if (arg === '--plugin') { result.pluginSpec = next; index += 1 }
    else if (arg.startsWith('--plugin=')) result.pluginSpec = arg.slice(9)
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

Modes:
  --mode npm          published dsh/plugin installation (default)
  --source            locked source checkout installation

Options:
  --root <dir>        install root (default ~/.local/share/dsh-agent-society-combo)
  --preset <id>       default TUI preset: anchored-standard (default), standard,
                      ptc, minimal, or cordis
  --source <name>=<path>
                      source mode; use an existing checkout instead of cloning
  --patch-only        clone + patch only; no dependency install/build/link
  --skip-deps         do not install npm/pnpm dependencies
  --skip-build        do not build
  --skip-links        do not create ~/.dsh and bin links
  --skip-config       do not write default TUI preferences
  --force-build       rebuild even when build markers exist
  --update            refresh this install to the current sources.lock.json
  --with-ssh [spec]   add an SSH ops plugin to the web profile
                      (source mode uses agent-society-web; default dsh-ssh-ops@0.2.1)
  --with-opencode-full
                      add the dsh-opencode-full bundle and switch the web
                      profile default preset to opencode-full
  --with-subscriptions
                      add dsh-plugin-subscriptions (ChatGPT/Claude/Grok
                      subscription LLM providers) to the web profile
  --with-host          install the optional @agent-society/agent-host package
  --without-host       do not install the optional agent-host package
  --dsh-package <spec> dsh package used by npm mode
  --plugin <spec>      AgentSociety plugin package used by npm mode
  --dry-run           print the plan without changing anything`
}

async function main() {
  if (!manifest.supportedPresets.includes(options.preset)) {
    throw new Error(
      `Unsupported preset "${options.preset}". Supported: ${manifest.supportedPresets.join(', ')}`,
    )
  }
  if (!['npm', 'source'].includes(options.mode)) {
    throw new Error(`Unsupported Combo mode "${options.mode}". Use --mode npm or --source`)
  }
  if (options.dryRun) {
    printPlan()
    return
  }
  if (options.mode === 'npm') {
    await installPublishedMode()
    return
  }
  await installSourceMode()
}

async function installPublishedMode() {
  console.log(`dsh-first npm installer (dsh-home: ${dshHome})${options.update ? ' [update]' : ''}`)
  const previousInstall = options.update
    ? readJson(join(stateRoot, 'combo-install.json'))
    : undefined
  const installHost =
    options.withHost ||
    (options.update && !options.withHostExplicit && previousInstall?.withHost === true)
  let dsh = resolveDshInvocation()
  if (!dsh) {
    throw new Error(
      `dsh was not found or is not executable. Install it first with: npm install -g ${options.dshPackage}`,
    )
  }
  if (options.update) {
    console.log(`[npm] update ${options.dshPackage}@${options.dshVersion}`)
    runChecked('npm', ['install', '--global', `${options.dshPackage}@${options.dshVersion}`], comboRoot)
    dsh = resolveDshInvocation()
    if (!dsh) throw new Error('dsh disappeared after the global package update')
  }
  if (!which('pnpm') && !which('corepack')) {
    throw new Error('pnpm is required by `dsh plugin`; install pnpm or enable corepack')
  }
  console.log(`[ok] dsh ${dsh.command} ${dsh.args.join(' ')}`.trim())
  const version = runCapture(dsh.command, [...dsh.args, '--version'], comboRoot, false)
  const actualVersion = version.stdout.trim().split(/\s+/u).at(-1)
  if (version.status !== 0 || actualVersion !== options.dshVersion) {
    throw new Error(
      'dsh ' +
        (actualVersion || 'unknown') +
        ' is incompatible. This Combo release requires ' +
        options.dshPackage +
        '@' +
        options.dshVersion +
        ' from Fantasia-Infinity/deepseek-harness',
    )
  }
  const profiles = ['web', 'headless', 'agent-society-worker']
  for (const profile of profiles) {
    const verb = options.update ? 'update' : 'add'
    console.log(`[plugin] ${verb} ${options.pluginSpec} -> ${profile}`)
    try {
      runDsh(dsh, ['plugin', '--profile', profile, verb, options.pluginSpec])
    } catch (error) {
      if (verb !== 'update') throw error
      console.warn(`[plugin] ${profile} did not have an updateable entry; adding it instead`)
      runDsh(dsh, ['plugin', '--profile', profile, 'add', options.pluginSpec])
    }
  }
  if (options.withSsh) {
    console.log(`[plugin] add ${options.sshPlugin} -> web`)
    runDsh(dsh, ['plugin', '--profile', 'web', 'add', options.sshPlugin])
  }
  if (options.withSubscriptions) {
    console.log('[plugin] add dsh-plugin-subscriptions -> web')
    runDsh(dsh, ['plugin', '--profile', 'web', 'add', 'dsh-plugin-subscriptions'])
  }
  ensureWorkerProfileActivation()
  if (installHost) {
    console.log('[npm] install optional @agent-society/agent-host')
    runChecked('npm', ['install', '--global', '@agent-society/agent-host'], comboRoot)
  }
  writeInstallState({
    mode: 'npm',
    dshPackage: options.dshPackage,
    expectedDshVersion: options.dshVersion,
    dshSource: 'Fantasia-Infinity/deepseek-harness',
    dshSourceCommit: manifest.components['deepseek-harness']?.commit,
    pluginSpec: options.pluginSpec,
    withHost: installHost,
    profiles,
    updatedAt: new Date().toISOString(),
  })
  if (!options.skipLinks) writeComboLauncher()
  console.log('')
  console.log('Install complete (dsh-first npm mode).')
  console.log(`  DSH_HOME: ${dshHome}`)
  console.log(`  plugin:   ${options.pluginSpec}`)
  console.log('')
  console.log('Next steps:')
  console.log('  agent setup --mode local   # optional thin management CLI')
  console.log('  agent doctor              # static checks; add --live for network checks')
  console.log('  dsh web                   # standard dsh Web profile')
  console.log('  dsh --profile agent-society-worker  # Hub worker profile')
}

async function installSourceMode() {
  console.log(`dsh-agent-society-combo installer (root: ${root})${options.update ? ' [update]' : ''}`)
  console.log(`preset: ${options.preset}  dsh-home: ${dshHome}`)

  const components = [
    'deepseek-harness',
    'dsh-tui',
    'agent-society',
    'dsh-anchored-standard',
    ...(options.withOpenCodeFull ? ['dsh-opencode-full'] : []),
  ]
  const changed = new Set()
  for (const name of components) {
    if (await installComponent(name)) changed.add(name)
  }

  if (options.patchOnly) {
    console.log('Patch-only install complete. Use `node scripts/doctor.mjs --root ' + root + '`.')
    return
  }

  const harness = componentDir('deepseek-harness')
  const tui = componentDir('dsh-tui')
  const agentSociety = componentDir('agent-society')
  const openCodeFull = options.withOpenCodeFull
    ? componentDir('dsh-opencode-full')
    : undefined

  if (!options.skipDeps) await installDependencies(harness, tui, agentSociety, openCodeFull, changed)
  if (!options.skipBuild) await buildAll(harness, tui, agentSociety, openCodeFull, changed)
  if (!options.skipLinks) {
    await createLinks(harness, tui, agentSociety)
    if (openCodeFull) await createOpenCodeFullLinks(openCodeFull)
    await ensureWebProfile(
      harness,
      agentSociety,
      options.withSsh ? options.sshPlugin : undefined,
      options.preset,
      openCodeFull,
      options.withSubscriptions,
    )
    writeComboLauncher()
  }
  if (!options.skipConfig) await writePreferences()
  writeInstallState({
    mode: 'source',
    root,
    dshHome,
    preset: options.preset,
    updatedAt: new Date().toISOString(),
    profiles: ['web', 'headless', 'agent-society-web', 'agent-society-worker'],
  })

  console.log('')
  console.log('Install complete.')
  console.log('  dsh:      ' + join(binDir, platform() === 'win32' ? 'dsh.cmd' : 'dsh'))
  console.log('  agent:    ' + join(binDir, platform() === 'win32' ? 'agent.cmd' : 'agent'))
  console.log('  dsh-tui:  ' + join(binDir, platform() === 'win32' ? 'dsh-tui.cmd' : 'dsh-tui'))
  if (openCodeFull) {
    console.log('  preset:   opencode-full (web default)')
  }
  console.log('')
  console.log('Next steps:')
  console.log('  1. Make sure "' + binDir + '" is on PATH.')
  console.log('  agent setup       # choose local / hub-worker / dispatch-only')
  console.log('  agent doctor      # static checks; add --live for network checks')
  console.log('  dsh web           # local DSH Web with AgentSociety')
  console.log('  dsh --profile agent-society-worker  # receive Hub tasks when configured')
}

function printPlan() {
  if (options.mode === 'npm') {
    console.log('Plan (published dsh-first mode):')
    console.log(`  verify dsh package ${options.dshPackage}`)
    for (const profile of ['web', 'headless', 'agent-society-worker']) {
      console.log(`  dsh plugin --profile ${profile} ${options.update ? 'update' : 'add'} ${options.pluginSpec}`)
    }
    if (options.withSsh) console.log(`  dsh plugin --profile web add ${options.sshPlugin}`)
    if (options.withSubscriptions) console.log('  dsh plugin --profile web add dsh-plugin-subscriptions')
    console.log('  write worker profile marker .env (AGENT_SOCIETY_WORKER=1)')
    console.log('  launch worker with dsh --profile agent-society-worker (profile-scoped activation)')
    if (options.withHost) console.log('  npm install --global @agent-society/agent-host')
    return
  }
  const names = [
    'deepseek-harness',
    'dsh-tui',
    'agent-society',
    'dsh-anchored-standard',
    ...(options.withOpenCodeFull ? ['dsh-opencode-full'] : []),
  ]
  console.log('Plan:')
  for (const name of names) {
    const comp = manifest.components[name]
    console.log(`  ensure ${comp.repo} @ ${comp.commit} -> ${componentDir(name)}`)
    for (const patch of comp.patches) console.log(`    apply ${patch.path}`)
  }
  console.log('  link ~/.dsh/plugins/agent-society')
  console.log('  copy ~/.dsh/.agent-presets/anchored-standard')
  console.log('  write ~/.dsh-tui/agent-preset.json = ' + options.preset)
  console.log('  links: dsh, dsh-tui, agent')
  console.log(`  web profiles: web + agent-society-web (core dsh-agent-society, preset ${options.preset})` + (options.withSsh ? ` + ${options.sshPlugin}` : ''))
  console.log('  headless profile: headless (core dsh-agent-society)')
  if (options.withOpenCodeFull) {
    console.log('  opencode-full: bundle + preset + web default preset')
  }
}

function resolveDshInvocation() {
  const configured = process.env.COMBO_DSH_COMMAND?.trim()
  const command = configured || 'dsh'
  const found = command.includes('/') || command.includes('\\')
    ? command
    : which(command)
  if (!found || !existsSync(found)) return undefined
  if (platform() === 'win32' || isExecutable(found)) return { command: found, args: [] }
  try {
    const target = realpathSync(found)
    if (target.endsWith('.js')) return { command: process.execPath, args: [target] }
  } catch {}
  return undefined
}

function runDsh(invocation, args) {
  runChecked(invocation.command, [...invocation.args, ...args], comboRoot, true, {
    DSH_HOME: dshHome,
  })
}

function ensureWorkerProfileActivation() {
  const profileDir = join(dshHome, 'profiles', 'agent-society-worker')
  ensureDir(profileDir)
  const envPath = join(profileDir, '.env')
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const lines = current
    .split(/\r?\n/u)
    .filter((line) => !/^\s*AGENT_SOCIETY_WORKER\s*=/u.test(line))
  if (lines.at(-1)?.trim()) lines.push('')
  lines.push('AGENT_SOCIETY_WORKER=1')
  writeFileSync(
    envPath,
    `${lines.join('\n').replace(/\n+$/u, '')}\n`,
    { mode: 0o600 },
  )
  if (platform() !== 'win32') chmodSync(envPath, 0o600)
}

function writeInstallState(state) {
  ensureDir(root)
  ensureDir(stateRoot)
  writeFileSync(
    join(stateRoot, 'combo-install.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  )
}

function persistInstallerKit() {
  const installerRoot = join(root, 'installer')
  ensureDir(installerRoot)
  if (resolve(comboRoot, 'scripts') !== resolve(installerRoot, 'scripts')) {
    cpSync(join(comboRoot, 'scripts'), join(installerRoot, 'scripts'), {
      recursive: true,
      force: true,
    })
  }
  if (resolve(comboRoot, 'patches') !== resolve(installerRoot, 'patches')) {
    cpSync(join(comboRoot, 'patches'), join(installerRoot, 'patches'), {
      recursive: true,
      force: true,
    })
  }
  if (resolve(comboRoot, 'sources.lock.json') !== resolve(installerRoot, 'sources.lock.json')) {
    copyFileSync(join(comboRoot, 'sources.lock.json'), join(installerRoot, 'sources.lock.json'))
  }
  return installerRoot
}

function writeComboLauncher() {
  const installerRoot = persistInstallerKit()
  ensureDir(binDir)
  const source = join(installerRoot, 'scripts', 'combo.mjs')
  if (platform() === 'win32') {
    writeCmd('combo', ['node', source])
  } else {
    linkExecutable(source, join(binDir, 'combo'))
  }
  console.log(`[link] combo -> ${source}`)
}

async function installComponent(name) {
  const comp = manifest.components[name]
  const dir = componentDir(name)
  const stateFile = join(stateRoot, `${name}.json`)
  const desiredState = {
    repo: comp.repo,
    commit: comp.commit,
    patches: Object.fromEntries(
      comp.patches.map((patch) => [patch.path, patch.sha256]),
    ),
    files: Object.fromEntries(
      comp.files.map((file) => [file.dest, file.sha256]),
    ),
  }
  const previousState = existsSync(stateFile)
    ? readJson(stateFile)
    : undefined
  const actualCommit = existsSync(join(dir, '.git'))
    ? runCapture('git', ['rev-parse', 'HEAD'], dir, false)
    : undefined
  const checkoutMatches =
    actualCommit?.status === 0 && actualCommit.stdout.trim() === comp.commit
  const sameState =
    previousState &&
    // Legacy state files predate the repo field; treat them as matching so
    // adding the field does not force a full reinstall for every component.
    (previousState.repo === undefined || previousState.repo === desiredState.repo) &&
    JSON.stringify({
      commit: previousState.commit,
      patches: previousState.patches,
      files: previousState.files,
    }) ===
      JSON.stringify({
        commit: desiredState.commit,
        patches: desiredState.patches,
        files: desiredState.files,
      }) &&
    checkoutMatches
  if (sameState) {
    console.log(`[ok] ${name} already at ${comp.commit}`)
    return false
  }

  if (sourceOverrides.has(name)) {
    console.log(`[use] ${name} <- ${sourceOverrides.get(name)}`)
    ensureDir(dirname(dir))
    linkOrCopy(sourceOverrides.get(name), dir)
    // Record the desired state anyway so doctor (and later --update runs)
    // see a consistent install; patches are never applied to a --source
    // checkout.
    ensureDir(stateRoot)
    writeFileSync(stateFile, `${JSON.stringify(desiredState, null, 2)}\n`)
    console.log(`[skip-patch] ${name} uses --source checkout; not applying patches`)
    return false
  } else {
    console.log(`[clone] ${comp.repo} @ ${comp.commit}`)
    ensureDir(dirname(dir))
    cloneAtCommit(comp.repo, comp.commit, dir, Boolean(previousState))
  }

  const status = runCapture('git', ['status', '--porcelain'], dir, false)
  if (status.status === 0 && status.stdout.trim() !== '') {
    throw new Error(
      `${name}: ${dir} has local changes. Commit or discard them before updating.`,
    )
  }
  runChecked('git', ['reset', '--hard', comp.commit], dir)
  // TUI >= 0.8.1 vendors @dsh-std via git submodules (vendor/dsh-std and
  // dsh-ecosystem-spec); initialize them so the pnpm workspace resolves.
  // A no-op for components without submodules.
  runChecked('git', ['submodule', 'update', '--init', '--recursive'], dir)
  removeStaleOverlays(dir, previousState?.files, desiredState.files)
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
  return true
}

function removeStaleOverlays(dir, previousFiles, desiredFiles) {
  if (!previousFiles || typeof previousFiles !== 'object') return
  for (const dest of Object.keys(previousFiles)) {
    if (Object.prototype.hasOwnProperty.call(desiredFiles, dest)) continue
    const target = join(dir, dest)
    if (!existsSync(target)) continue
    const tracked = runCapture(
      'git',
      ['ls-files', '--error-unmatch', '--', dest],
      dir,
      false,
    )
    if (tracked.status !== 0) {
      rmSync(target, { force: true })
      console.log(`[remove] stale overlay ${dest}`)
    }
  }
}

function cloneAtCommit(repo, commit, dir, managed = false) {
  if (existsSync(join(dir, '.git'))) {
    const status = runCapture('git', ['status', '--porcelain'], dir, false)
    if (status.status !== 0 || status.stdout.trim() !== '') {
      if (!managed) {
        throw new Error(`${dir} is dirty; commit or remove it before updating`)
      }
      const backup = `${dir}.pre-update-${Date.now()}`
      console.warn(`[backup] ${dir} has local changes; preserving at ${backup}`)
      renameSync(dir, backup)
    } else {
      // Follow a changed source repository: point origin at the current
      // manifest URL before fetching, so a fork swap takes effect on the
      // next update instead of silently keeping the old remote.
      const origin = runCapture(
        'git',
        ['remote', 'get-url', 'origin'],
        dir,
        false,
      )
      if (origin.status === 0 && origin.stdout.trim() !== repo) {
        console.log(`[remote] origin -> ${repo}`)
        runChecked('git', ['remote', 'set-url', 'origin', repo], dir)
      }
      runChecked('git', ['fetch', '--quiet', 'origin'], dir)
      runChecked('git', ['checkout', '--quiet', commit], dir)
      return
    }
  }
  rmSync(dir, { recursive: true, force: true })
  runChecked(
    'git',
    ['clone', '--quiet', '--filter=blob:none', '--no-checkout', repo, dir],
    comboRoot,
  )
  runChecked('git', ['checkout', '--quiet', commit], dir)
}

async function installDependencies(harness, tui, agentSociety, openCodeFull, changed) {
  const installHarness = changed.has('deepseek-harness') || !existsSync(join(harness, 'node_modules', '.pnpm'))
  console.log(installHarness ? '[deps] deepseek-harness pnpm install' : '[skip] deepseek-harness node_modules current')
  if (installHarness) pnpm(harness, ['install', '--frozen-lockfile'])

  const installTui = changed.has('dsh-tui') || !existsSync(join(tui, 'node_modules', 'react'))
  console.log(installTui ? '[deps] dsh-TUI pnpm install' : '[skip] dsh-TUI node_modules current')
  // Upstream moved to pnpm (package-lock.json -> pnpm-lock.yaml); its
  // `prepare` script compiles with tsc before deps are linked, so install
  // with scripts skipped and let buildAll run the real compile. The pinned
  // TUI compatibility patch rewrites its development dependency versions for
  // the sibling DSH checkout, while those prerelease package versions are not
  // all published to npm. Bootstrap dependencies against the checkout's
  // original package/lock pair, then restore the patched files byte-for-byte;
  // buildAll links the actual sibling DSH packages immediately afterwards.
  if (installTui) installTuiBootstrapDependencies(tui)

  const installAgentHost = changed.has('agent-society') || !existsSync(join(agentSociety, 'agent-host', 'node_modules'))
  console.log(installAgentHost ? '[deps] AgentSociety agent-host npm ci' : '[skip] agent-host node_modules current')
  if (installAgentHost) {
    installSourcePackageWithoutLocalDependency(
      join(agentSociety, 'agent-host'),
      '@agent-society/agent-config',
    )
  }

  const agentConfig = join(agentSociety, 'agent-config')
  if (existsSync(join(agentConfig, 'package.json'))) {
    const installAgentConfig =
      changed.has('agent-society') ||
      !existsSync(join(agentConfig, 'node_modules', 'typescript'))
    console.log(
      installAgentConfig
        ? '[deps] AgentSociety shared config npm install'
        : '[skip] shared config node_modules current',
    )
    if (installAgentConfig) {
      runChecked('npm', ['install', '--ignore-scripts', '--no-package-lock'], agentConfig)
    }
  }

  const installPlugin = changed.has('agent-society') || !existsSync(join(agentSociety, 'dsh-plugin', 'node_modules', 'typescript'))
  console.log(installPlugin ? '[deps] AgentSociety dsh-plugin npm ci' : '[skip] dsh-plugin node_modules current')
  if (installPlugin) {
    // Source mode intentionally builds against the pinned DSH checkout rather
    // than the published npm package. Install only the plugin's published
    // dependencies; local DSH packages are linked from the checkout
    // immediately before the plugin build. Keep the source manifest and
    // lockfile byte-for-byte unchanged after this bootstrap install.
    const pluginDir = join(agentSociety, 'dsh-plugin')
    if (existsSync(join(harness, 'packages', 'core', 'agent', 'package.json'))) {
      const packageFile = join(pluginDir, 'package.json')
      const lockFile = join(pluginDir, 'package-lock.json')
      const originalPackage = readFileSync(packageFile, 'utf8')
      const hadLock = existsSync(lockFile)
      const originalLock = hadLock ? readFileSync(lockFile, 'utf8') : undefined
      try {
        const packageJson = JSON.parse(originalPackage)
        for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
          const values = packageJson[section]
          if (!values || typeof values !== 'object') continue
          for (const name of Object.keys(values)) {
            if (
              name.startsWith('@deepseek-ai/dsh-') ||
              name === '@agent-society/agent-config'
            ) delete values[name]
          }
        }
        writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`)
        if (hadLock) rmSync(lockFile, { force: true })
        runChecked('npm', ['install', '--ignore-scripts', '--no-package-lock', '--legacy-peer-deps'], pluginDir)
      } finally {
        writeFileSync(packageFile, originalPackage)
        if (hadLock) writeFileSync(lockFile, originalLock)
        else rmSync(lockFile, { force: true })
      }
    } else {
      runChecked('npm', ['ci'], pluginDir)
    }
  }

  if (openCodeFull) {
    const installOpenCodeFull = changed.has('dsh-opencode-full') || !existsSync(join(openCodeFull, 'node_modules', 'typescript'))
    console.log(installOpenCodeFull ? '[deps] dsh-opencode-full npm ci' : '[skip] dsh-opencode-full node_modules current')
    if (installOpenCodeFull) runChecked('npm', ['ci'], openCodeFull)
  }
}

function installTuiBootstrapDependencies(tui) {
  const files = ['package.json', 'pnpm-lock.yaml']
  const originals = new Map()
  const pinned = new Map()
  for (const file of files) {
    const path = join(tui, file)
    if (!existsSync(path)) continue
    originals.set(file, readFileSync(path, 'utf8'))
    const result = runCapture('git', ['show', `HEAD:${file}`], tui, false)
    if (result.status !== 0) {
      // A user-supplied source checkout may not be a git worktree. In that
      // case retain its own manifest and let pnpm report any real mismatch.
      pnpm(tui, ['install', '--frozen-lockfile', '--ignore-scripts'])
      return
    }
    pinned.set(file, result.stdout)
  }
  try {
    for (const [file, content] of pinned) writeFileSync(join(tui, file), content)
    pnpm(tui, ['install', '--frozen-lockfile', '--ignore-scripts'])
  } finally {
    for (const [file, content] of originals) writeFileSync(join(tui, file), content)
  }
}

function installSourcePackageWithoutLocalDependency(packageDir, dependency) {
  const packageFile = join(packageDir, 'package.json')
  const lockFile = join(packageDir, 'package-lock.json')
  const originalPackage = readFileSync(packageFile, 'utf8')
  const hadLock = existsSync(lockFile)
  const originalLock = hadLock ? readFileSync(lockFile, 'utf8') : undefined
  try {
    const packageJson = JSON.parse(originalPackage)
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const values = packageJson[section]
      if (values && typeof values === 'object') delete values[dependency]
    }
    writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + '\n')
    if (hadLock) rmSync(lockFile, { force: true })
    runChecked(
      'npm',
      ['install', '--ignore-scripts', '--no-package-lock', '--legacy-peer-deps'],
      packageDir,
    )
  } finally {
    writeFileSync(packageFile, originalPackage)
    if (hadLock) writeFileSync(lockFile, originalLock)
    else rmSync(lockFile, { force: true })
  }
}

function linkLocalDshPackages(harness, pluginDir) {
  const packageRoot = join(pluginDir, 'node_modules', '@deepseek-ai')
  ensureDir(packageRoot)
  const packages = []
  const visit = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue
      const child = join(dir, entry.name)
      const manifestPath = join(child, 'package.json')
      if (existsSync(manifestPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8'))
          if (typeof packageJson.name === 'string' && packageJson.name.startsWith('@deepseek-ai/')) packages.push({ name: packageJson.name, dir: child })
        } catch {}
      }
      visit(child, depth + 1)
    }
  }
  for (const root of [join(harness, 'packages'), join(harness, 'apps'), join(harness, 'vendor')]) visit(root)
  const seen = new Set()
  for (const item of packages) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    const target = join(packageRoot, item.name.slice('@deepseek-ai/'.length))
    if (existsSync(target) || isLink(target)) rmSync(target, { recursive: true, force: true })
    symlinkSync(item.dir, target, 'dir')
  }
  console.log(`[link] ${seen.size} local DSH packages -> ${packageRoot}`)
}

async function buildAll(harness, tui, agentSociety, openCodeFull, changed) {
  const harnessBin = join(harness, 'apps', 'cli', 'lib', 'bin.js')
  const bootLib = join(harness, 'packages', 'boot', 'app-boot', 'lib', 'index.js')
  // Client-face packages (@deepseek-ai/dsh-typert-registry,
  // @deepseek-ai/dsh-api-gateway, ...) are emitted only by the Client pass;
  // the dsh-TUI bundle rows load them at boot, so the full build:lib
  // (host + client passes) is required for a working TUI.
  const clientLib = join(harness, 'packages', 'api', 'gateway', 'lib', 'index.js')
  if (
    options.forceBuild ||
    changed.has('deepseek-harness') ||
    !existsSync(harnessBin) ||
    !existsSync(bootLib) ||
    !existsSync(clientLib)
  ) {
    console.log('[build] deepseek-harness build:lib (host + client passes)')
    pnpm(harness, ['run', 'build:lib'])
  } else {
    console.log('[skip] deepseek-harness already built')
  }

  // The agent-society-web profile mounts the browser surface, which resolves
  // @deepseek-ai/dsh-web-frontend/dist/index.html. build:lib alone does not
  // emit that dist, so the web UI would boot and then fail on first request.
  const webDist = join(harness, 'apps', 'web', 'dist', 'index.html')
  if (
    options.forceBuild ||
    changed.has('deepseek-harness') ||
    !existsSync(webDist)
  ) {
    console.log('[build] deepseek-harness build:web (browser frontend)')
    pnpm(harness, ['run', 'build:web'])
  } else {
    console.log('[skip] deepseek-harness web dist already built')
  }

  const tuiPlugin = join(tui, 'lib', 'types', 'index.js')
  if (
    options.forceBuild ||
    changed.has('dsh-tui') ||
    !existsSync(tuiPlugin)
  ) {
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

  const agentConfig = join(agentSociety, 'agent-config')
  if (existsSync(join(agentConfig, 'package.json'))) {
    if (options.forceBuild || changed.has('agent-society') || !existsSync(join(agentConfig, 'lib', 'index.js'))) {
      console.log('[build] AgentSociety shared config')
      runChecked('npm', ['run', 'build'], agentConfig)
    } else {
      console.log('[skip] shared config already built')
    }
    linkLocalPackage(agentConfig, join(agentSociety, 'agent-host'), '@agent-society/agent-config')
    linkLocalPackage(agentConfig, join(agentSociety, 'dsh-plugin'), '@agent-society/agent-config')
  }

  console.log('[build] AgentSociety agent-host')
  runChecked('npm', ['run', 'build'], join(agentSociety, 'agent-host'))

  linkLocalDshPackages(harness, join(agentSociety, 'dsh-plugin'))
  console.log('[build] AgentSociety dsh-plugin')
  runChecked('npm', ['run', 'build'], join(agentSociety, 'dsh-plugin'))

  if (openCodeFull) {
    const lib = join(openCodeFull, 'lib', 'apply-patch.js')
    if (options.forceBuild || changed.has('dsh-opencode-full') || !existsSync(lib)) {
      console.log('[build] dsh-opencode-full')
      runChecked('npm', ['run', 'build'], openCodeFull)
    } else {
      console.log('[skip] dsh-opencode-full already built')
    }
  }
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

  // agent-host resolves its sibling dsh-TUI checkout by the canonical repo
  // name `dsh-TUI` (cli.ts runDshTui), while this installer keeps the
  // component at `sources/dsh-tui`. On case-sensitive filesystems (Linux)
  // that lookup misses and `agent` silently falls back to the Pi TUI.
  // Mirror the canonical name. macOS/Windows filesystems are
  // case-insensitive, so the guard below simply no-ops there.
  if (platform() !== 'win32') {
    const tuiAlias = join(sourcesRoot, 'dsh-TUI')
    const tuiDir = componentDir('dsh-tui')
    if (!existsSync(tuiAlias) && !isLink(tuiAlias)) {
      try {
        symlinkSync(tuiDir, tuiAlias, 'dir')
        console.log(`[link] ${tuiAlias} -> ${tuiDir}`)
      } catch (error) {
        console.warn(
          `[warn] could not create ${tuiAlias}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else {
      console.log(`[keep] ${tuiAlias} already exists`)
    }
  }

  // Source mode uses the same standard dsh profile names as npm mode. Keep
  // agent-society-web below as a compatibility profile for older Host/bridge
  // configurations, but make `dsh web` and `dsh --profile headless` carry the
  // local AgentSociety bundle too.
  for (const profileName of ['web', 'headless', 'agent-society-worker']) {
    ensureSourcePluginProfile(harness, pluginSource, profileName)
  }
  ensureWorkerProfileActivation()
  ensureSessionCompressionCompatibility()
}

function ensureSourcePluginProfile(harness, pluginSource, profileName) {
  const dshBin = join(binDir, platform() === 'win32' ? 'dsh.cmd' : 'dsh')
  const result = runCapture(
    process.execPath,
    [join(harness, 'apps', 'cli', 'lib', 'bin.js'), 'plugin', '--profile', profileName, 'add', pluginSource],
    comboRoot,
    true,
    { DSH_HOME: dshHome },
  )
  if (result.status !== 0) {
    console.warn(`[warn] dsh plugin profile bootstrap failed for ${profileName}; run manually:`)
    console.warn(`  ${dshBin} plugin --profile ${profileName} add ${pluginSource}`)
  } else {
    console.log(`[profile] ${profileName} includes AgentSociety source plugin`)
  }
}

function ensureSessionCompressionCompatibility() {
  const envPath = join(dshHome, '.env')
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  if (/^\s*AGENT_SOCIETY_SESSION_COMPRESSION\s*=/mu.test(current)) return

  const sessionRoot = join(dshHome, 'sessions')
  const hasZstd = findFileSuffix(sessionRoot, '.jsonl.zstd')
  const hasPlain = findFileSuffix(sessionRoot, '.jsonl')
  if (!hasZstd || hasPlain) {
    if (hasZstd && hasPlain) {
      console.warn(`[warn] mixed session compression detected under ${sessionRoot}; set AGENT_SOCIETY_SESSION_COMPRESSION explicitly before starting dsh`)
    }
    return
  }

  const lines = current.split(/\r?\n/u)
  if (lines.at(-1)?.trim()) lines.push('')
  lines.push('AGENT_SOCIETY_SESSION_COMPRESSION=zstd')
  writeFileSync(
    envPath,
    `${lines.join('\n').replace(/\n+$/u, '')}\n`,
    { mode: 0o600 },
  )
  if (platform() !== 'win32') chmodSync(envPath, 0o600)
  console.log(`[config] existing .jsonl.zstd sessions detected; set AGENT_SOCIETY_SESSION_COMPRESSION=zstd in ${envPath}`)
}

function findFileSuffix(dir, suffix) {
  if (!existsSync(dir)) return false
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isFile() && entry.name.endsWith(suffix)) return true
    if (entry.isDirectory() && findFileSuffix(child, suffix)) return true
  }
  return false
}

function linkLocalPackage(source, packageDir, packageName) {
  const scope = join(packageDir, 'node_modules', packageName.split('/')[0])
  const target = join(packageDir, 'node_modules', packageName)
  ensureDir(scope)
  if (existsSync(target) || isLink(target)) rmSync(target, { recursive: true, force: true })
  symlinkSync(source, target, 'dir')
  console.log('[link] ' + target + ' -> ' + source)
}

async function loadOpenCodeFullInstallKit(openCodeFull) {
  return await import(pathToFileURL(join(openCodeFull, 'scripts', 'install-kit.mjs')).href)
}

async function createOpenCodeFullLinks(openCodeFull) {
  ensureDir(join(dshHome, '.agent-presets'))
  const source = join(openCodeFull, 'presets', 'opencode-full')
  const dest = join(dshHome, '.agent-presets', 'opencode-full')
  const kit = await loadOpenCodeFullInstallKit(openCodeFull)
  kit.atomicCopyDir(source, dest)
  console.log(`[preset] copy opencode-full -> ${dest}`)
}

async function detectOpenCodeFullLspServers(openCodeFull) {
  try {
    const module = await import(pathToFileURL(join(openCodeFull, 'scripts', 'lsp-detect.mjs')).href)
    return module.detectLspServers()
  } catch (error) {
    console.warn(`[warn] could not run dsh-opencode-full lsp detection: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

async function ensureWebProfile(harness, agentSociety, sshSpec, preset, openCodeFull, withSubscriptions) {
  const profile =
    process.env.COMBO_WEB_PROFILE ||
    process.env.COMBO_SSH_PROFILE ||
    'agent-society-web'
  const pluginSource = join(agentSociety, 'dsh-plugin')
  const corePlugin = '@agent-society/dsh-agent-society'
  const dependencies = {
    [corePlugin]: `link:${pluginSource}`,
  }
  const bundles = [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    corePlugin,
  ]
  if (openCodeFull) {
    const openCodeFullPlugin = '@fantasia-infinity/dsh-opencode-full'
    dependencies[openCodeFullPlugin] = `link:${openCodeFull}`
    bundles.push(openCodeFullPlugin)
    // The dsh profile resolver resolves bundle-row package names from the
    // profile directory, not through a linked bundle's own node_modules.
    // Pin the LSP stack to the managed harness checkout so the composed
    // versions match the pinned deepseek-harness commit exactly.
    for (const [lspPackage, lspDir] of [
      ['dsh-lsp', 'lsp'],
      ['dsh-lsp-stdio', 'lsp-stdio'],
      ['dsh-tool-lsp', 'tool-lsp'],
    ]) {
      dependencies[`@deepseek-ai/${lspPackage}`] =
        `link:${join(harness, 'packages', 'lsp', lspDir)}`
    }
  }
  let sshName
  if (sshSpec) {
    const at = sshSpec.lastIndexOf('@')
    sshName = at > 0 ? sshSpec.slice(0, at) : sshSpec
    const version = at > 0 ? sshSpec.slice(at + 1) : undefined
    if (!sshName) throw new Error('--with-ssh requires a plugin package name')
    if (version) dependencies[sshName] = version
    bundles.push(sshName)
  }
  if (withSubscriptions) {
    // ChatGPT (Codex) / Claude / Grok subscription providers with OAuth
    // login from the web Settings page; tokens live under ~/.dsh/plugins/
    // subscriptions/auth.json and are untouched by the installer.
    dependencies['dsh-plugin-subscriptions'] = '^0.3.1'
    bundles.push('dsh-plugin-subscriptions')
  }
  const profileDir = join(dshHome, 'profiles', profile)
  const presetName = openCodeFull ? 'opencode-full' : preset
  console.log(`[web] profile ${profile} core=${corePlugin} preset=${presetName}${openCodeFull ? ' opencode-full' : ''}${sshName ? ` ssh=${sshName}` : ''}${withSubscriptions ? ' subscriptions' : ''}`)
  ensureDir(profileDir)
  ensureDir(binDir)
  const packageJson = {
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  writeFileSync(
    join(profileDir, 'pnpm-workspace.yaml'),
    sshName
      ? `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  cpu-features: true\n  ssh2: true\n`
      : `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`,
  )
  writeFileSync(join(profileDir, 'cordis.yml'), '# generated by dsh-agent-society-combo\n[]\n')
  const lspServers = openCodeFull
    ? await detectOpenCodeFullLspServers(openCodeFull)
    : {}
  const installKit = openCodeFull
    ? await loadOpenCodeFullInstallKit(openCodeFull)
    : undefined
  const patchFile = join(profileDir, 'cordis.patch.yml')
  let managedPatch =
    '# Generated by dsh-agent-society-combo; re-running the installer regenerates this file.\n' +
    '# Machine-local overrides belong in $DSH_HOME/cordis.patch.yml.\n' +
    '- id: agent-presets\n' +
    "  name: '@deepseek-ai/dsh-agent-presets'\n" +
    '  config:\n' +
    `    default: ${presetName}\n\n` +
    '- id: session-persistence-jsonl\n' +
    '  config:\n' +
    "    root: !!js dshHomePath('sessions')\n" +
    "    compression: !!js process.env.AGENT_SOCIETY_SESSION_COMPRESSION || 'zstd'\n"
  const lspBlock = installKit?.renderLspServerBlock(lspServers) ?? ''
  if (lspBlock) managedPatch += `\n${lspBlock}\n`
  if (existsSync(patchFile) && readFileSync(patchFile, 'utf8') !== managedPatch) {
    const backup = `${patchFile}.combo-backup-${Date.now()}`
    writeFileSync(backup, readFileSync(patchFile, 'utf8'))
    console.warn(`[web] preserving previous profile patch at ${backup}`)
  }
  writeFileSync(patchFile, managedPatch)
  pnpm(profileDir, ['install'])
  const probe = runCapture(
    process.execPath,
    [join(harness, 'apps', 'cli', 'lib', 'bin.js'), '--profile', profile, '--dump-default-config'],
    comboRoot,
    false,
  )
  if (probe.status === 0 && probe.stdout.includes(corePlugin)) {
    console.log(`[web] ${corePlugin} registered in profile ${profile}`)
  } else {
    console.warn(`[warn] could not verify ${corePlugin} in profile ${profile}`)
  }
  if (openCodeFull && probe.status === 0 && probe.stdout.includes('@fantasia-infinity/dsh-opencode-full')) {
    console.log(`[web] dsh-opencode-full registered in profile ${profile}`)
  }
  if (sshName && probe.status === 0 && probe.stdout.includes(sshName)) {
    console.log(`[ssh] ${sshName} registered in profile ${profile}`)
  }
  if (platform() === 'win32') {
    writeCmd('dsh-web', ['node', join(harness, 'apps', 'cli', 'lib', 'bin.js'), '--profile', profile])
    if (sshName) writeCmd('dsh-web-ops', ['node', join(harness, 'apps', 'cli', 'lib', 'bin.js'), '--profile', profile])
  } else {
    for (const name of sshName ? ['dsh-web', 'dsh-web-ops'] : ['dsh-web']) {
      const wrapper = join(binDir, name)
      if (!existsSync(wrapper) && !isLink(wrapper)) {
        writeFileSync(
          wrapper,
          `#!/bin/sh\nexec node ${JSON.stringify(join(harness, 'apps', 'cli', 'lib', 'bin.js'))} --profile ${profile} "$@"\n`,
          { mode: 0o755 },
        )
      }
    }
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
  if (!existsSync(source)) {
    throw new Error(`executable source missing: ${source}`)
  }
  // A failed build/source-slot operation can leave the target of an otherwise
  // correct symlink at mode 0600. chmod the managed source before deciding
  // that the existing link is healthy; spawn() does not use a shell and will
  // report that case as EACCES.
  chmodSync(source, 0o755)
  if (existsSync(target) || isLink(target)) {
    if (isLink(target) && samePath(target, source) && isExecutable(target)) {
      console.log(`[keep] ${target} -> ${source} (executable)`)
      return
    }
    const backup = `${target}.combo-backup-${Date.now()}`
    renameSync(target, backup)
    console.warn(`[backup] replacing stale executable ${target}; preserved at ${backup}`)
  }
  ensureDir(dirname(target))
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
    const direct = join(source, name)
    const nested = join(source, 'preset', name)
    const src = existsSync(direct)
      ? direct
      : existsSync(nested)
        ? nested
        : undefined
    if (!src) throw new Error(`preset file missing: ${direct} (or ${nested})`)
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
    false,
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
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return resolve(left) === resolve(right)
  }
}
