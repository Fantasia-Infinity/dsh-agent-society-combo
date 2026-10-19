import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const rootDir = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

test("published dry-run is dsh-first and does not schedule source checkout work", () => {
  const output = execFileSync(process.execPath, [join(rootDir, "scripts/install.mjs"), "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.match(output, /dsh plugin --profile web add @agent-society\/dsh-agent-society/u);
  assert.match(output, /agent-society-worker/u);
  assert.doesNotMatch(output, /git clone/u);
});

test("source dry-run adapts dsh without scheduling the archived TUI", () => {
  const output = execFileSync(process.execPath, [join(rootDir, "scripts/install.mjs"), "--source", "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.match(output, /deepseek-harness/u);
  assert.match(output, /7422271b91753b4c53051e875b3f96961e57c979/u);
  assert.doesNotMatch(output, /dsh-tui|TUI|\.dsh-tui/iu);
  assert.doesNotMatch(output, /anchored-standard|opencode-full/iu);
  assert.match(output, /0003-dsh-first-runtime\.patch/u);
  assert.match(output, /0009-dsh-0\.1\.7-rc2-api-compat\.patch/u);
  assert.doesNotMatch(output, /0001-standalone-source-launcher\.patch/u);
  assert.doesNotMatch(output, /0007-rc7-cmdlineargs-ctx-get\.patch/u);
  assert.doesNotMatch(output, /0009-dsh-alpha-api-adaptation\.patch/u);
  assert.doesNotMatch(output, /0003-live-adoption-revision-retry\.patch/u);
});

test("retired TUI source overrides fail before installation", () => {
  const result = spawnSync(process.execPath, [join(rootDir, "scripts/install.mjs"), "--source", "dsh-tui=/unused", "--dry-run"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown source component "dsh-tui"/u);
});

test("retired preset installation options fail before installation", () => {
  for (const args of [
    ["--with-opencode-full"],
    ["--preset", "anchored-standard"],
    ["--source", "dsh-anchored-standard=/unused"],
    ["--source", "dsh-opencode-full=/unused"],
  ]) {
    const result = spawnSync(process.execPath, [join(rootDir, "scripts/install.mjs"), ...args, "--dry-run"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired|Unknown source component|Unsupported preset/u);
    assert.doesNotMatch(result.stdout, /\[clone\]|\[build\]/u);
  }
});

test("active source maintenance includes only Harness and AgentSociety", async () => {
  const manifest = JSON.parse(await readFile(join(rootDir, "sources.lock.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.components).sort(), ["agent-society", "deepseek-harness"]);
  assert.equal(manifest.defaultPreset, "standard");
});

test("archived TUI manifests retain verifiable patch and launcher contents", async () => {
  const archive = JSON.parse(await readFile(join(rootDir, "archive/dsh-tui/sources.lock.json"), "utf8"));
  const component = archive.components["dsh-tui"];
  for (const item of [...component.patches, ...component.files]) {
    const content = await readFile(join(rootDir, item.path || item.src));
    assert.equal(createHash("sha256").update(content).digest("hex"), item.sha256);
  }
  const active = JSON.parse(await readFile(join(rootDir, "sources.lock.json"), "utf8"));
  assert.equal(Object.hasOwn(active.components, "dsh-tui"), false);
});

test("source update preserves retired checkouts, launchers, profiles, and presets", async () => {
  const temp = await mkdtemp(join(tmpdir(), "combo-retired-"));
  const installRoot = join(temp, "combo");
  const dshHome = join(temp, "dsh");
  const bin = join(temp, "bin");
  const userHome = join(temp, "home");
  try {
    const sentinels = [
      join(installRoot, "sources/dsh-tui/keep.txt"),
      join(installRoot, "state/dsh-tui.json"),
      join(dshHome, "profiles/dsh-tui/cordis.patch.yml"),
      join(bin, "dsh-tui"),
      join(userHome, ".dsh-tui/agent-preset.json"),
      join(installRoot, "sources/dsh-anchored-standard/keep.txt"),
      join(installRoot, "sources/dsh-opencode-full/keep.txt"),
      join(installRoot, "state/dsh-anchored-standard.json"),
      join(installRoot, "state/dsh-opencode-full.json"),
      join(dshHome, ".agent-presets/anchored-standard/preset.yml"),
      join(dshHome, ".agent-presets/opencode-full/preset.yml"),
    ];
    const overrides = [];
    for (const name of ["deepseek-harness", "agent-society"]) {
      const source = join(temp, name);
      await mkdir(source, { recursive: true });
      overrides.push("--source", `${name}=${source}`);
    }
    for (const path of sentinels) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "preserve existing TUI data\n");
    }
    const output = execFileSync(process.execPath, [join(rootDir, "scripts/install.mjs"), "--root", installRoot,
      ...overrides, "--update", "--skip-deps", "--skip-build", "--skip-links", "--skip-config"], {
      env: { ...process.env, HOME: userHome, USERPROFILE: userHome, DSH_HOME: dshHome, COMBO_BIN: bin },
      encoding: "utf8",
    });
    assert.match(output, /Install complete/u);
    assert.doesNotMatch(output, /dsh-tui|TUI|\.dsh-tui/iu);
    assert.doesNotMatch(output, /anchored-standard|opencode-full/iu);
    for (const path of sentinels) assert.equal(await readFile(path, "utf8"), "preserve existing TUI data\n");
    const report = spawnSync(process.execPath, [join(rootDir, "scripts/doctor.mjs"), "--root", installRoot, "--json"], {
      env: { ...process.env, DSH_HOME: dshHome }, encoding: "utf8",
    });
    assert.equal(JSON.parse(report.stdout).checks.some(item => /tui|anchored-standard|opencode-full/iu.test(item.name)), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("doctor accepts a non-executable dsh JavaScript shim through Node fallback", async () => {
  const temp = await mkdtemp(join(tmpdir(), "combo-doctor-"));
  const installRoot = join(temp, "combo");
  const dshHome = join(temp, "dsh");
  const bin = join(temp, "bin");
  const workspace = join(temp, "workspace");
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(bin, "dsh.js"),
      "if (process.argv.includes('--version')) console.log('0.1.2-alpha.2');\n",
      { mode: 0o644 },
    );
    await mkdir(join(dshHome, "profiles"), { recursive: true });
    await writeFile(join(dshHome, ".env"), `AGENT_DSH_MODEL="deepseek-v4-flash"\nAGENT_WORKSPACE_ROOT="${workspace}"\nAGENT_CREDENTIAL_BACKEND="env"\n`);
    for (const profile of ["web", "headless", "agent-society-worker"]) {
      const profileDir = join(dshHome, "profiles", profile);
      await mkdir(join(profileDir, "node_modules", "@agent-society", "dsh-agent-society"), { recursive: true });
      await writeFile(
        join(profileDir, "package.json"),
        JSON.stringify({
          dependencies: { "@agent-society/dsh-agent-society": "0.2.0" },
          dsh: { profile: { bundles: ["@agent-society/dsh-agent-society"] } },
        }),
      );
      await writeFile(join(profileDir, "node_modules", "@agent-society", "dsh-agent-society", "package.json"), "{}");
      if (profile === "agent-society-worker") {
        await writeFile(join(profileDir, ".env"), "AGENT_SOCIETY_WORKER=1\n", { mode: 0o600 });
      }
    }
    const webFrontend = join(dshHome, "profiles", "web", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist");
    const webModules = join(dshHome, "profiles", "web", "node_modules", "@deepseek-ai", "dsh-client-modules", "lib");
    await mkdir(webFrontend, { recursive: true });
    await mkdir(webModules, { recursive: true });
    await writeFile(join(webFrontend, "index.html"), '<script src="@deepseek-ai/dsh-client-modules/client.js"></script>');
    await writeFile(join(webModules, "client.js"), "export {};\n");
    await mkdir(join(installRoot, "state"), { recursive: true });
    await writeFile(
      join(installRoot, "state", "combo-install.json"),
      JSON.stringify({
        mode: "npm",
        dshPackage: "@deepseek-ai/dsh",
        expectedDshVersion: "0.1.2-alpha.2",
        pluginSpec: "@agent-society/dsh-agent-society",
        withHost: false,
      }),
    );
    const output = execFileSync(process.execPath, [join(rootDir, "scripts/doctor.mjs"), "--json", "--root", installRoot], {
      cwd: rootDir,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        COMBO_DSH_COMMAND: join(bin, "dsh.js"),
        PATH: `${bin}:${process.env.PATH || ""}`,
      },
      encoding: "utf8",
    });
    const report = JSON.parse(output);
    assert.equal(report.failures, 0, output);
    const dshCheck = report.checks.find((item) => item.name === "dsh command");
    assert.match(dshCheck.detail, /node/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
