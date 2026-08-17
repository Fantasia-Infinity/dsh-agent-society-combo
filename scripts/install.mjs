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
  renameSync,
  rmSync,
  statSync,
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
    update: false,
    withSsh: false,
    sshPlugin: process.env.COMBO_SSH_PLUGIN || 'dsh-ssh-ops@0.2.1',
    withOpenCodeFull: process.env.COMBO_OPENCODE_FULL === '1',
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
    else if (arg === '--update') result.update = true
    else if (arg === '--with-ssh') { result.withSsh = true; if (next && !next.startsWith('--')) { result.sshPlugin = next; index += 1 } }
    else if (arg.startsWith('--with-ssh=')) { result.withSsh = true; result.sshPlugin = arg.slice(11) }
    else if (arg === '--with-opencode-full') result.withOpenCodeFull = true
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
  --update            refresh this install to the current sources.lock.json
  --with-ssh [spec]   add an SSH ops plugin to the agent-society-web profile
                      (default dsh-ssh-ops@0.2.1)
  --with-opencode-full
                      add the dsh-opencode-full bundle and switch the web
                      profile default preset to opencode-full
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
    )
  }
  if (!options.skipConfig) await writePreferences()

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
  console.log('  2. Configure credentials:  cd ' + agentSociety + ' && ./agent setup')
  console.log('  3. Start:                  agent')
}

function printPlan() {
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
  console.log(`  web profile: agent-society-web (core dsh-agent-society, preset ${options.preset})` + (options.withSsh ? ` + ${options.sshPlugin}` : ''))
  if (options.withOpenCodeFull) {
    console.log('  opencode-full: bundle + preset + web default preset')
  }
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
    existsSync(join(dir, '.git'))
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
  // with scripts skipped and let buildAll run the real compile.
  if (installTui) pnpm(tui, ['install', '--frozen-lockfile', '--ignore-scripts'])

  const installAgentHost = changed.has('agent-society') || !existsSync(join(agentSociety, 'agent-host', 'node_modules'))
  console.log(installAgentHost ? '[deps] AgentSociety agent-host npm ci' : '[skip] agent-host node_modules current')
  if (installAgentHost) runChecked('npm', ['ci'], join(agentSociety, 'agent-host'))

  const installPlugin = changed.has('agent-society') || !existsSync(join(agentSociety, 'dsh-plugin', 'node_modules', 'typescript'))
  console.log(installPlugin ? '[deps] AgentSociety dsh-plugin npm ci' : '[skip] dsh-plugin node_modules current')
  if (installPlugin) runChecked('npm', ['ci'], join(agentSociety, 'dsh-plugin'))

  if (openCodeFull) {
    const installOpenCodeFull = changed.has('dsh-opencode-full') || !existsSync(join(openCodeFull, 'node_modules', 'typescript'))
    console.log(installOpenCodeFull ? '[deps] dsh-opencode-full npm ci' : '[skip] dsh-opencode-full node_modules current')
    if (installOpenCodeFull) runChecked('npm', ['ci'], openCodeFull)
  }
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
  if (options.forceBuild || changed.has('dsh-tui') || !existsSync(tuiPlugin)) {
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

async function ensureWebProfile(harness, agentSociety, sshSpec, preset, openCodeFull) {
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
  const profileDir = join(dshHome, 'profiles', profile)
  const presetName = openCodeFull ? 'opencode-full' : preset
  console.log(`[web] profile ${profile} core=${corePlugin} preset=${presetName}${openCodeFull ? ' opencode-full' : ''}${sshName ? ` ssh=${sshName}` : ''}`)
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
    return statSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
