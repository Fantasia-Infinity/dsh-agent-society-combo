#!/usr/bin/env node
/** Package built AgentSociety code without checkout or unpublished dependencies. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { source: { type: 'string' }, output: { type: 'string' } } });
if (!values.source || !values.output) throw new Error('Usage: node scripts/package-standalone.mjs --source BUILT_AGENTSOCIETY --output NEW_DIRECTORY');
const source = resolve(values.source);
const output = resolve(values.output);
if (existsSync(output)) throw new Error('Output already exists: ' + output);
for (const path of ['agent-config/lib/index.js', 'dsh-plugin/lib/config-plugin.js', 'agent-host/dist/src/cli.js']) {
  if (!existsSync(join(source, path))) throw new Error('Build first: missing ' + path);
}
mkdirSync(output, { recursive: true });
const artifacts = [];
for (const kind of ['dsh-plugin', 'agent-host']) {
  const input = join(source, kind);
  const target = join(output, kind);
  const manifest = JSON.parse(readFileSync(join(input, 'package.json')));
  mkdirSync(target);
  const paths = kind === 'dsh-plugin' ? ['lib', 'cordis.patch.yml'] : ['dist/src', 'scripts', 'config', 'adapters', 'dsh'];
  for (const path of paths) {
    if (existsSync(join(input, path))) cpSync(join(input, path), join(target, path), { recursive: true, filter: path => !path.endsWith('.map') });
  }
  cpSync(join(source, 'LICENSE'), join(target, 'LICENSE'));
  const runtime = kind === 'dsh-plugin' ? join(target, 'lib') : join(target, 'dist/src');
  for (const suffix of ['js', 'd.ts']) cpSync(join(source, 'agent-config/lib/index.' + suffix), join(runtime, 'agent-config.' + suffix));
  const rewrite = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) rewrite(path);
      else if (/\.(?:js|ts|mjs)$/u.test(entry.name)) {
        const text = readFileSync(path, 'utf8');
        writeFileSync(path, text.replaceAll('@agent-society/agent-config', './agent-config.js').replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
      }
    }
  };
  rewrite(runtime);
  delete manifest.devDependencies;
  for (const key of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) delete manifest[key]?.['@agent-society/agent-config'];
  manifest.peerDependenciesMeta ||= {};
  for (const name of Object.keys(manifest.peerDependencies || {})) {
    if (name.startsWith('@deepseek-ai/')) manifest.peerDependenciesMeta[name] = { optional: true };
  }
  if (kind === 'dsh-plugin') {
    manifest.optionalDependencies = { ...manifest.optionalDependencies, '@napi-rs/keyring': '1.3.0' };
    manifest.scripts = {};
    manifest.files = ['lib', 'cordis.patch.yml', 'LICENSE'];
  } else {
    for (const key of ['prepack', 'build', 'check', 'test']) delete manifest.scripts[key];
  }
  writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: target, encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || join(output, '.npm-cache') },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const info = JSON.parse(result.stdout)[0];
  const sha256 = createHash('sha256').update(readFileSync(join(output, info.filename))).digest('hex');
  artifacts.push({ name: manifest.name, version: manifest.version, filename: info.filename, sha256, integrity: info.integrity });
}
writeFileSync(join(output, 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n');
console.log(JSON.stringify(artifacts, null, 2));
