import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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

test("source dry-run remains explicit and keeps the TUI in the locked source set", () => {
  const output = execFileSync(process.execPath, [join(rootDir, "scripts/install.mjs"), "--source", "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.match(output, /deepseek-harness/u);
  assert.match(output, /e11c574ada805aebd587262a1635fab2743c586e/u);
  assert.match(output, /dsh-TUI/u);
  assert.match(output, /1062bbb0ad608b2fe6adfa9001aa1038144764b7/u);
  assert.match(output, /0014-dsh-0\.1\.7-rc2-contract\.patch/u);
  assert.match(output, /0010-standalone-source-launcher-0\.10\.patch/u);
  assert.match(output, /0011-dsh-0\.1\.5-runtime-context\.patch/u);
  assert.match(output, /0003-dsh-first-runtime\.patch/u);
  assert.match(output, /0009-dsh-0\.1\.7-rc2-api-compat\.patch/u);
  assert.doesNotMatch(output, /0001-standalone-source-launcher\.patch/u);
  assert.doesNotMatch(output, /0007-rc7-cmdlineargs-ctx-get\.patch/u);
  assert.doesNotMatch(output, /0009-dsh-alpha-api-adaptation\.patch/u);
  assert.doesNotMatch(output, /0003-live-adoption-revision-retry\.patch/u);
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
