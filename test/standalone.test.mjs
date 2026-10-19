import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

test('active DSH is unmodified and AgentSociety patches have valid checksums', async () => {
  const lock = JSON.parse(await readFile(join(root, 'sources.lock.json'), 'utf8'));
  assert.deepEqual(lock.components['deepseek-harness'].patches, []);
  assert.ok(lock.published.dsh.supportedVersions.includes('0.2.0-rc.2'));
  for (const patch of lock.components['agent-society'].patches) {
    const content = await readFile(join(root, patch.path));
    assert.equal(createHash('sha256').update(content).digest('hex'), patch.sha256, patch.path);
  }
});

test('prebuilt packages embed shared config and do not install another DSH runtime', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'combo-package-test-'));
  const source = join(temp, 'source');
  const output = join(temp, 'release');
  const put = async (path, value) => {
    const target = join(source, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, value);
  };
  try {
    await put('LICENSE', 'test license');
    await put('agent-config/lib/index.js', 'export const value = 42;\n');
    await put('agent-config/lib/index.d.ts', 'export declare const value: number;\n');
    await put('dsh-plugin/cordis.patch.yml', '[]\n');
    for (const [kind, runtime] of [['dsh-plugin', 'lib/config-plugin.js'], ['agent-host', 'dist/src/cli.js']]) {
      await put(kind + '/' + runtime, 'export { value } from "@agent-society/agent-config";\n//# sourceMappingURL=source.js.map\n');
      await put(kind + '/' + runtime + '.map', 'must not ship');
      await put(kind + '/package.json', JSON.stringify({
        name: '@agent-society/' + kind, version: '0.0.0-test', type: 'module',
        files: ['dist', 'scripts'],
        scripts: { prepack: 'exit 97', build: 'exit 98' },
        dependencies: { '@agent-society/agent-config': 'file:../agent-config' },
        devDependencies: { typescript: '*' },
        peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
      }));
    }
    const artifacts = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/package-standalone.mjs'), '--source', source, '--output', output], { encoding: 'utf8' }));
    assert.equal(artifacts.length, 2);
    for (const [kind, runtime] of [['dsh-plugin', 'lib/config-plugin.js'], ['agent-host', 'dist/src/cli.js']]) {
      const manifest = JSON.parse(await readFile(join(output, kind, 'package.json'), 'utf8'));
      assert.equal(manifest.dependencies['@agent-society/agent-config'], undefined);
      assert.equal(manifest.devDependencies, undefined);
      assert.equal(manifest.scripts.prepack, undefined);
      assert.equal(manifest.peerDependenciesMeta['@deepseek-ai/dsh'].optional, true);
      const module = await import(join(output, kind, runtime));
      assert.equal(module.value, 42);
      const artifact = artifacts.find(a => a.name === manifest.name);
      const archive = await readFile(join(output, artifact.filename));
      assert.equal(createHash('sha256').update(archive).digest('hex'), artifact.sha256);
      const listing = execFileSync('tar', ['-tzf', join(output, artifact.filename)], { encoding: 'utf8' });
      assert.doesNotMatch(listing, /node_modules|\.map\b/);
      assert.ok(listing.split('\n').filter(p => p.endsWith('.ts')).every(p => p.endsWith('.d.ts')));
      assert.match(listing, /agent-config\.js/);
    }
    const duplicate = spawnSync(process.execPath, [join(root, 'scripts/package-standalone.mjs'), '--source', source, '--output', output], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Output already exists/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
