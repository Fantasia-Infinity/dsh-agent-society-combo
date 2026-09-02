#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const installerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installScript = resolve(installerDir, "scripts", "install.mjs");
const doctorScript = resolve(installerDir, "scripts", "doctor.mjs");
const persistentRoot = resolve(installerDir, "..");
if (
  !process.env.COMBO_ROOT &&
  existsSync(resolve(persistentRoot, "state", "combo-install.json"))
) {
  process.env.COMBO_ROOT = persistentRoot;
}

const argv = process.argv.slice(2);
const command = argv.shift() || "install";
let script;
let args = argv;
if (command === "install") {
  script = installScript;
} else if (command === "update") {
  script = installScript;
  const explicitMode = Boolean(
    process.env.COMBO_MODE?.trim() ||
      argv.includes("--source") ||
      argv.some((arg) => arg === "--mode" || arg.startsWith("--mode=")),
  );
  let currentMode;
  try {
    currentMode = JSON.parse(
      readFileSync(resolve(persistentRoot, "state", "combo-install.json"), "utf8"),
    ).mode;
  } catch {
    currentMode = undefined;
  }
  // An update should preserve the installed distribution mode. In particular,
  // a source checkout must not silently turn into a global npm install just
  // because the caller omitted the historical `--source` switch.
  args = [
    "--update",
    ...(currentMode === "source" && !explicitMode ? ["--source"] : []),
    ...argv,
  ];
} else if (command === "doctor") {
  script = doctorScript;
} else if (command === "--help" || command === "-h" || command === "help") {
  console.log(`Usage: combo <install|update|doctor> [options]

  combo install [--source]       install published dsh/plugin packages
  combo update                   update the current installation
  combo doctor [--live] [--json] inspect profiles and runtime health
`);
  process.exit(0);
} else {
  console.error(`Unknown combo command: ${command}. Use combo --help.`);
  process.exit(2);
}

if (!existsSync(script)) {
  console.error(`Combo management script is missing: ${script}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, [script, ...args], {
  cwd: persistentRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
