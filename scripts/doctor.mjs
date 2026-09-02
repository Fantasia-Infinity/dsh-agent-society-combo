#!/usr/bin/env node
/**
 * Static-first doctor for the dsh-first Combo installation.
 *
 * The default path only inspects local files and runs dsh --version. Network,
 * model, Hub, and Web startup checks are opt-in through --live.
 */

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const comboRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const options = parseArgs(process.argv.slice(2));
const root = resolve(
  options.root ||
    process.env.COMBO_ROOT ||
    join(home, ".local", "share", "dsh-agent-society-combo"),
);
const dshHome = resolve(process.env.DSH_HOME || join(home, ".dsh"));
const comboManifest = readJson(join(comboRoot, "sources.lock.json")) || {};
const publishedDsh = comboManifest.published?.dsh || {};
const publishedPlugin = comboManifest.published?.agentSocietyPlugin || {};
const statePath = join(root, "state", "combo-install.json");
const state = readJson(statePath) || {};
const mode =
  state.mode ||
  (existsSync(join(root, "sources", "deepseek-harness")) ? "source" : "npm");
const checks = [];

await main();

async function main() {
  if (mode === "source") doctorSource();
  else await doctorNpm();
  if (options.live) await doctorLive();
  const failures = checks.filter((item) => item.status === "fail").length;
  if (options.json) {
    console.log(
      JSON.stringify(
        { mode, root, dshHome, live: options.live, failures, checks },
        null,
        2,
      ),
    );
  } else {
    for (const item of checks) {
      const detail = item.detail ? " — " + item.detail : "";
      console.log(item.statusText + " " + item.name + detail);
      if (item.fix && item.status === "fail") console.log("  fix: " + item.fix);
    }
    console.log("");
    if (failures) {
      console.log(failures + " check(s) failed.");
      process.exitCode = 1;
    } else {
      console.log("All Combo checks passed.");
    }
  }
  if (failures) process.exitCode = 1;
}

function parseArgs(argv) {
  const result = { live: false, json: false, root: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") result.live = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--root") result.root = argv[++index];
    else if (arg?.startsWith("--root=")) result.root = arg.slice(7);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/doctor.mjs [--live] [--json] [--root DIR]");
      process.exit(0);
    } else {
      throw new Error("Unknown doctor option: " + arg);
    }
  }
  return result;
}

function check(name, ok, detail = "", fix = "") {
  checks.push({
    status: ok ? "ok" : "fail",
    statusText: ok ? "[ok]" : "[fail]",
    name,
    detail,
    ...(fix ? { fix } : {}),
  });
}

function warn(name, detail = "", fix = "") {
  checks.push({
    status: "warn",
    statusText: "[warn]",
    name,
    detail,
    ...(fix ? { fix } : {}),
  });
}

async function doctorNpm() {
  const dshPackage = state.dshPackage || publishedDsh.package || "@deepseek-ai/dsh";
  const pluginPackage =
    state.pluginSpec || publishedPlugin.package || "@agent-society/dsh-agent-society";
  const expectedDshVersion =
    process.env.COMBO_DSH_VERSION ||
    state.expectedDshVersion ||
    publishedDsh.version ||
    "0.1.2-alpha.4";
  const dsh = resolveDshInvocation();
  check(
    "dsh command",
    Boolean(dsh),
    dsh ? dsh.join(" ") : "not found or not executable",
    dsh ? "" : "npm install -g " + dshPackage + "@" + expectedDshVersion,
  );
  if (dsh) {
    const version = runCapture(dsh[0], [...dsh.slice(1), "--version"]);
    const actual = version.stdout.trim().split(/\s+/u).at(-1) || "";
    check(
      "dsh fork release",
      version.status === 0 && actual === expectedDshVersion,
      "expected " +
        expectedDshVersion +
        " from " +
        (publishedDsh.source || "Fantasia-Infinity/deepseek-harness") +
        "; got " +
        (actual || "unknown"),
      "npm install -g " + dshPackage + "@" + expectedDshVersion,
    );
  }

  for (const profile of ["web", "headless", "agent-society-worker"]) {
    doctorProfile(profile, profile === "agent-society-worker", pluginPackage);
  }
  const canonical = join(dshHome, ".env");
  const legacy = findLegacyConfig();
  const explicit = process.env.AGENT_ENV_FILE?.trim();
  const configPath =
    explicit && existsSync(explicit)
      ? resolve(explicit)
      : existsSync(canonical)
        ? canonical
        : legacy;
  check(
    "shared configuration",
    Boolean(configPath),
    configPath || "missing " + canonical,
    "agent setup --mode local",
  );
  const values = configPath ? parseEnv(readFileSync(configPath, "utf8")) : {};
  if (legacy && legacy !== configPath) {
    warn(
      "legacy configuration",
      legacy + " remains readable; canonical path is " + canonical,
      "agent setup --mode local",
    );
  }
  const configured = Boolean(
    values.AGENT_DSH_MODEL ||
      values.AGENT_REMOTE_MODEL ||
      values.LLM_MODEL ||
      values.PI_MODEL,
  );
  check(
    "model configuration",
    configured || Boolean(process.env.DSH_MODEL),
    configured ? "model settings found" : "no AgentSociety model setting",
    "agent setup --mode local",
  );
  checkWorkspace(values.AGENT_WORKSPACE_ROOT);
  checkCredential(values);
  checkHubConfiguration(values);
  const globalAgent = findCommand("agent");
  if (state.withHost) {
    check(
      "optional agent-host command",
      Boolean(globalAgent),
      globalAgent || "agent-host is not installed",
      "npm install -g @agent-society/agent-host",
    );
  } else {
    warn("optional agent-host", "not requested; dsh remains the primary runtime");
  }
  const webHtml = findWebHtml(dsh);
  if (!webHtml) {
    check(
      "dsh Web frontend artifact",
      false,
      "published dsh package has no discoverable frontend index.html",
      "npm install -g " + dshPackage + "@" + expectedDshVersion,
    );
  } else {
    const html = readFileSafe(webHtml);
    if (html.includes("@deepseek-ai/dsh-client-modules/client.js")) {
      check(
        "dsh Web client-modules preload",
        true,
        webHtml + " contains the required preload",
      );
    } else {
      // dsh injects this profile-dependent URL while composing the Web
      // response; the raw Vite index is intentionally not the final HTML.
      warn(
        "dsh Web client-modules preload",
        webHtml + " relies on dsh runtime HTML injection",
        "combo doctor --live",
      );
    }
  }
  const clientModule = findClientModule(dsh);
  check(
    "dsh Web client-modules artifact",
    Boolean(clientModule),
    clientModule || "@deepseek-ai/dsh-client-modules/lib/client.js is missing",
    "npm install -g " + dshPackage + "@" + expectedDshVersion,
  );
  checkWorkerIsolation();
}

function doctorProfile(profile, worker, pluginPackage) {
  const profileDir = join(dshHome, "profiles", profile);
  const packagePath = join(profileDir, "package.json");
  const pluginName = packageName(pluginPackage);
  check(
    profile + " profile",
    existsSync(packagePath),
    packagePath,
    "dsh plugin --profile " + profile + " add " + pluginPackage,
  );
  if (!existsSync(packagePath)) return;
  const manifest = readJson(packagePath) || {};
  const bundles = manifest.dsh?.profile?.bundles;
  const installed =
    (Array.isArray(bundles) &&
      bundles.includes(pluginName)) ||
    Object.prototype.hasOwnProperty.call(
      manifest.dependencies || {},
      pluginName,
    );
  check(
    profile + " AgentSociety plugin",
    installed,
    installed ? "registered" : "plugin entry missing",
      "dsh plugin --profile " + profile + " add " + pluginPackage,
  );
  const pluginPath = join(
    profileDir,
    "node_modules",
    ...pluginName.split("/"),
    "package.json",
  );
  check(
    profile + " AgentSociety plugin artifact",
    !installed || existsSync(pluginPath),
    installed ? pluginPath : "not registered; artifact check skipped",
    "dsh plugin --profile " + profile + " add " + pluginPackage,
  );
  const envPath = join(profileDir, ".env");
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  if (worker) {
    check(
      profile + " worker activation",
      env.AGENT_SOCIETY_WORKER === "1",
      envPath + " must contain AGENT_SOCIETY_WORKER=1",
      "printf 'AGENT_SOCIETY_WORKER=1\\n' > " + envPath,
    );
  } else {
    check(
      profile + " does not activate worker",
      env.AGENT_SOCIETY_WORKER !== "1",
      "worker flag leaked into the non-worker profile",
      "remove AGENT_SOCIETY_WORKER from " + envPath,
    );
  }
}

function checkWorkerIsolation() {
  const globalEnv = join(dshHome, ".env");
  const values = existsSync(globalEnv) ? parseEnv(readFileSync(globalEnv, "utf8")) : {};
  check(
    "global worker isolation",
    values.AGENT_SOCIETY_WORKER !== "1",
    globalEnv + " must not enable worker mode",
    "remove AGENT_SOCIETY_WORKER from " + globalEnv,
  );
}

function checkWorkspace(value) {
  const workspace = resolve(value || home);
  const checkout = resolve(root, "sources", "agent-society");
  check(
    "workspace",
    workspace !== checkout &&
      !workspace.startsWith(checkout + "/") &&
      !workspace.startsWith(checkout + "\\"),
    workspace,
    "agent setup --mode local",
  );
}

function checkCredential(values) {
  const backend = values.AGENT_CREDENTIAL_BACKEND || "auto";
  const credentialFile = values.AGENT_CREDENTIAL_FILE;
  if (backend === "file" || credentialFile) {
    const path = resolve(credentialFile || join(dshHome, "credentials.env"));
    if (!existsSync(path)) {
      check(
        "credential file",
        false,
        path + " is missing",
        "agent setup --credentials file",
      );
      return;
    }
    const mode = platform() === "win32" ? 0o600 : statSync(path).mode & 0o777;
    check(
      "credential file permissions",
      platform() === "win32" || mode === 0o600,
      path + " mode " + mode.toString(8),
      "chmod 600 " + path,
    );
    warn(
      "credential persistence risk",
      path + " is an explicit 0600 file backend",
    );
  } else if (backend === "env") {
    warn(
      "environment-only credentials",
      "secrets are not persisted; export them before starting dsh",
    );
  } else {
    warn(
      "credential backend",
      "auto/system store; no secret content is displayed",
    );
  }
}

function checkHubConfiguration(values) {
  const url = process.env.AGENT_HUB_URL?.trim() || values.AGENT_HUB_URL;
  if (!url) {
    warn("Hub configuration", "not configured; this is valid for local mode");
    return;
  }
  const account =
    process.env.AGENT_HUB_USERNAME?.trim() || values.AGENT_HUB_USERNAME;
  const token = Boolean(
    process.env.AGENT_HUB_TOKEN?.trim() ||
      values.AGENT_HUB_TOKEN ||
      process.env.AGENT_HUB_TOKEN_CREDENTIAL_SERVICE?.trim() ||
      values.AGENT_HUB_TOKEN_CREDENTIAL_SERVICE ||
      process.env.AGENT_HUB_PASSWORD?.trim() ||
      values.AGENT_HUB_PASSWORD_CREDENTIAL_SERVICE ||
      process.env.AGENT_HUB_NODE_TOKEN?.trim() ||
      values.AGENT_HUB_NODE_TOKEN_CREDENTIAL_SERVICE,
  );
  check(
    "Hub configuration",
    Boolean(account || token),
    url + " is configured without an account or credential reference",
    "agent setup --mode hub-worker",
  );
}

function doctorSource() {
  const manifest = readJson(join(comboRoot, "sources.lock.json")) || {};
  const components = manifest.components || {};
  for (const [name, component] of Object.entries(components)) {
    const dir = join(root, "sources", name);
    const optional = name === "dsh-opencode-full";
    const checkout = existsSync(join(dir, ".git"));
    const stateFile = join(root, "state", name + ".json");
    if (optional && !checkout && !existsSync(stateFile)) continue;
    check(name + " checkout", checkout, dir);
    check(name + " state", existsSync(stateFile), stateFile);
    if (checkout) {
      const result = runCapture("git", ["-C", dir, "rev-parse", "HEAD"]);
      const actual = result.stdout.trim();
      check(
        name + " commit",
        actual === component.commit,
        "wanted " + component.commit + ", got " + (actual || "unknown"),
        "node scripts/install.mjs --source --update",
      );
    }
  }
  const harness = join(root, "sources", "deepseek-harness");
  const tui = join(root, "sources", "dsh-tui");
  const agent = join(root, "sources", "agent-society");
  check("source dsh CLI", existsSync(join(harness, "apps", "cli", "lib", "bin.js")));
  check("source dsh Web build", existsSync(join(harness, "apps", "web", "dist", "index.html")));
  check("source dsh-TUI build", existsSync(join(tui, "lib", "types", "index.js")));
  check("source AgentSociety Host build", existsSync(join(agent, "agent-host", "dist", "src", "cli.js")));
  check("source AgentSociety plugin build", existsSync(join(agent, "dsh-plugin", "lib", "worker-plugin.js")));
  check(
    "source dsh client-modules artifact",
    existsSync(join(harness, "packages", "client", "modules", "lib", "client.js")),
    "packages/client/modules/lib/client.js",
    "node scripts/install.mjs --source --update",
  );
  const canonical = join(dshHome, ".env");
  const legacy = findLegacyConfig(agent);
  check(
    "shared configuration",
    existsSync(canonical) || Boolean(legacy),
    canonical + (legacy ? " or " + legacy : ""),
    "agent setup --mode local",
  );
  if (legacy && legacy !== canonical) {
    warn("legacy configuration", legacy + " remains readable; run agent setup to migrate");
  }
  const plugin = join(dshHome, "plugins", "agent-society", "cordis.patch.yml");
  check("source AgentSociety plugin link", existsSync(plugin), plugin);
  for (const profile of ["web", "headless", "agent-society-worker"]) {
    doctorProfile(profile, profile === "agent-society-worker", "@agent-society/dsh-agent-society");
  }
  checkWorkerIsolation();
}

async function doctorLive() {
  const dsh = resolveDshInvocation();
  if (!dsh) return;
  await liveHubCheck();
  await liveWebSmoke(dsh);
}

async function liveHubCheck() {
  const configPath = existsSync(join(dshHome, ".env"))
    ? join(dshHome, ".env")
    : findLegacyConfig();
  const values = configPath ? parseEnv(readFileSync(configPath, "utf8")) : {};
  const url = process.env.AGENT_HUB_URL || values.AGENT_HUB_URL;
  if (!url) {
    warn("live Hub check", "Hub is not configured");
    return;
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    check(
      "live Hub reachability",
      response.status < 500,
      url + " returned HTTP " + response.status,
      "agent connect",
    );
    await response.body?.cancel();
  } catch (error) {
    check(
      "live Hub reachability",
      false,
      error instanceof Error ? error.message : String(error),
      "agent connect",
    );
  }
}

async function liveWebSmoke(dsh) {
  const port = process.env.COMBO_DOCTOR_WEB_PORT || "31876";
  const child = spawn(
    dsh[0],
    [...dsh.slice(1), "web", "--no-open", "--port", port],
    {
      cwd: home,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  let html = "";
  let launchUrl = "";
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const ready = /dsh web: (http:\/\/[^\s]+)/u.exec(output);
      if (ready?.[1]) launchUrl = ready[1];
      if (launchUrl) {
        const exchange = await fetch(launchUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(500),
        });
        const cookieHeader = exchange.headers.get("set-cookie");
        const location = exchange.headers.get("location");
        if (exchange.status === 303 && cookieHeader && location) {
          const authenticatedUrl = new URL(location, launchUrl);
          const response = await fetch(authenticatedUrl, {
            headers: { cookie: cookieHeader.split(";", 1)[0] },
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) html = await response.text();
        }
        if (html) break;
      }
    } catch {
      // The readiness line can race the first authenticated request. Retry
      // until the Web process is ready or the bounded smoke deadline expires.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, 500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  // The shipped client bundle contains this error message as a defensive
  // runtime string. Only a message emitted by the dsh process is evidence
  // that the current response failed to preload the client modules.
  const badPreload = output.includes("HTML did not preload");
  check(
    "live dsh Web startup",
    Boolean(html) && !badPreload,
    html ? "HTTP response received" : output.trim().slice(-500) || "no HTTP response",
    "npm install -g @deepseek-ai/dsh@0.1.2-alpha.4 && dsh web --no-open",
  );
  if (html) {
    const hasClientPreload = html.includes(
      "@deepseek-ai/dsh-client-modules/client.js",
    );
    check(
      "live Web client-modules preload",
      hasClientPreload,
      hasClientPreload
        ? "rendered Web HTML includes client-modules preload"
        : "rendered Web HTML has no client-modules preload",
      "update the dsh package and rerun combo doctor --live",
    );
  }
}

function findLegacyConfig(cwd = join(root, "sources", "agent-society")) {
  const configHome =
    platform() === "win32"
      ? process.env.APPDATA || join(home, "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || join(home, ".config");
  const candidates = [
    join(configHome, "agentsociety", "agent.env"),
    join(cwd, ".private", "env", "agent.env"),
    join(cwd, ".env.agent"),
  ];
  return candidates.find((path) => existsSync(path));
}

function findWebHtml(dsh) {
  const profileDir = join(dshHome, "profiles", "web");
  const candidates = [
    join(profileDir, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist", "index.html"),
    join(profileDir, "node_modules", "@deepseek-ai", "dsh-web-frontend", "index.html"),
  ];
  if (dsh?.[1]) {
    const cli = realpathSafe(dsh[1]);
    if (cli) {
      const packageRoot = resolve(dirname(cli), "..");
      candidates.push(
        join(packageRoot, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist", "index.html"),
        join(packageRoot, "node_modules", "@deepseek-ai", "dsh-web-frontend", "index.html"),
      );
    }
  }
  return candidates.find((path) => existsSync(path));
}

function findClientModule(dsh) {
  const candidates = [
    join(
      dshHome,
      "profiles",
      "web",
      "node_modules",
      "@deepseek-ai",
      "dsh-client-modules",
      "lib",
      "client.js",
    ),
  ];
  if (dsh?.[1]) {
    const cli = realpathSafe(dsh[1]);
    if (cli) {
      const packageRoot = resolve(dirname(cli), "..");
      candidates.push(
        join(packageRoot, "node_modules", "@deepseek-ai", "dsh-client-modules", "lib", "client.js"),
        join(packageRoot, "node_modules", "@deepseek-ai", "dsh-client-modules", "client.js"),
      );
    }
  }
  return candidates.find((path) => existsSync(path));
}

function packageName(spec) {
  const slash = spec.indexOf("/");
  const at = spec.lastIndexOf("@");
  return at > slash ? spec.slice(0, at) : spec;
}

function resolveDshInvocation() {
  const configured = process.env.COMBO_DSH_COMMAND?.trim() || "dsh";
  const path = findCommand(configured);
  if (!path) return undefined;
  if (platform() === "win32" || executable(path)) return [path];
  const target = realpathSafe(path);
  if (target?.endsWith(".js")) return [process.execPath, target];
  return undefined;
}

function findCommand(command) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : undefined;
  }
  const entries = (process.env.PATH || "").split(platform() === "win32" ? ";" : ":");
  return entries
    .map((entry) => (entry ? join(entry, command) : ""))
    .find((candidate) => candidate && existsSync(candidate));
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function runCapture(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readFileSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}
