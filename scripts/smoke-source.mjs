import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Usage: node scripts/smoke-source.mjs --root /path/to/isolated/combo
// Requires built sources. Uses only local mock Hub/MCP and a keyless adapter.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--root")
  throw new Error("Usage: node scripts/smoke-source.mjs --root DIR");
const root = resolve(args[1]);
const harness = join(root, "sources/deepseek-harness");
const plugin = join(root, "sources/agent-society/dsh-plugin");
const observer = fileURLToPath(
  new URL("../test/fixtures/source-runtime-observer.mjs", import.meta.url),
);
const home = await mkdtemp(join(tmpdir(), "combo-source-smoke-"));
const requests = [];
let claimed = false,
  completed = null;
const task = {
  task_id: "smoke-task",
  principal_id: "smoke-owner",
  delegator_actor_id: "smoke-client",
  assignee_actor_id: "smoke-worker",
  objective: "Reply with COMBO_RC2_OK",
  required_capabilities: [],
  input: { tool_policy: "no_tools" },
  status: "submitted",
  result: {},
  error: null,
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  requests.push(path);
  const json = (value) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (path === "/mcp") {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (!Object.hasOwn(body, "id")) {
      res.writeHead(202).end();
      return;
    }
    const tools = [
      {
        name: "hub_context_read",
        description: "Smoke Hub context",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    let result;
    if (body.method === "initialize")
      result = {
        protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "combo-hub-mock", version: "1.0.0" },
      };
    else if (body.method === "tools/list") result = { tools };
    else if (body.method === "tools/call") {
      result = { content: [{ type: "text", text: "mock hub state" }] };
    } else result = {};
    json({ jsonrpc: "2.0", id: body.id, result });
    return;
  }
  if (path === "/v1/hub/tasks/claim") {
    const claim = claimed
      ? null
      : {
          task,
          run: {
            run_id: "smoke-run",
            task_id: task.task_id,
            principal_id: task.principal_id,
            actor_id: "smoke-worker",
            node_id: "smoke-node",
            status: "active",
            result: {},
          },
          lease_token: "smoke-only-lease",
        };
    claimed = true;
    json({ claim });
    return;
  }
  if (
    path === "/v1/hub/tasks/smoke-task" ||
    path === "/v1/hub/tasks/smoke-task/updates"
  ) {
    if (body.status === "completed") completed = body;
    json({ task: { ...task, ...body } });
    return;
  }
  if (path.endsWith("/events")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": connected\n\n");
    return;
  }
  if (path.startsWith("/v1/hub/artifacts")) {
    json({ artifact: { artifact_id: "smoke-artifact" } });
    return;
  }
  json({
    rows: [],
    events: [],
    questions: [],
    controls: [],
    nodes: [],
    run: {},
    row: {},
    event: { seq: 1 },
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const hub = "http://127.0.0.1:" + server.address().port;
for (const [profile, bundles] of Object.entries({
  web: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
  headless: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
  "agent-society-worker": ["@deepseek-ai/dsh-base"],
})) {
  const dir = join(home, "profiles", profile);
  await mkdir(join(dir, "node_modules/@agent-society"), { recursive: true });
  await symlink(
    plugin,
    join(dir, "node_modules/@agent-society/dsh-agent-society"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@agent-society/dsh-agent-society": "link:" + plugin },
      dsh: {
        profile: { bundles: [...bundles, "@agent-society/dsh-agent-society"] },
      },
    }),
  );
}
const overlay = join(home, "smoke.patch.json");
await writeFile(
  overlay,
  JSON.stringify([
    { id: "hmr", disabled: true },
    {
      id: "agent-default-model",
      config: { provider: "combo-mock", model: "deepseek-flash" },
    },
    { id: "session-title-llm", disabled: true },
    {
      insert: [
        { id: "combo-smoke-observer", name: pathToFileURL(observer).href },
      ],
    },
  ]),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !k.startsWith("AGENT_") &&
      !k.startsWith("DSH_") &&
      !k.startsWith("DEEPSEEK_") &&
      !["NODE_OPTIONS", "NODE_PATH"].includes(k),
  ),
);
Object.assign(env, {
  COMBO_SMOKE_HARNESS: harness,
  HOME: home,
  USERPROFILE: home,
  DSH_HOME: home,
  DSH_AGENTS_HOME: join(home, ".agents"),
  DSH_TELEMETRY_DISABLED: "1",
  AGENT_ENV_FILE: join(home, "no-user-config"),
  AGENT_CREDENTIAL_BACKEND: "env",
  AGENT_SOCIETY_HUB_URL: hub,
  AGENT_SOCIETY_HUB_TOKEN: "smoke-only-token",
  AGENT_SOCIETY_HUB_MCP: "1",
  AGENT_SOCIETY_WORKSPACE_ROOT: home,
  AGENT_SOCIETY_PROVIDER: "combo-mock",
  AGENT_SOCIETY_DIRECTORY: "0",
  AGENT_SOCIETY_QUESTIONS: "0",
  AGENT_SOCIETY_CONTEXT: "0",
  AGENT_SELF_UPDATE: "0",
  AGENT_SOCIETY_POLL_SECONDS: "1",
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (ms) => new Promise((r) => setTimeout(r, ms).unref());
const children = [];
try {
  for (const profile of ["web", "headless", "agent-society-worker"]) {
    const before = requests.filter((p) => p.endsWith("/tasks/claim")).length;
    const extra =
      profile === "web"
        ? ["--host", "127.0.0.1", "--port", "0", "--no-open"]
        : profile === "headless"
          ? ["Say COMBO_RC2_OK"]
          : [];
    const child = spawn(
      process.execPath,
      [
        join(harness, "apps/cli/lib/bin.js"),
        "--profile",
        profile,
        "--patch",
        overlay,
        ...extra,
      ],
      { cwd: home, env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    children.push(child);
    let output = "",
      exited = false;
    child.stdout.on("data", (s) => {
      output += s;
    });
    child.stderr.on("data", (s) => {
      output += s;
    });
    const closed = once(child, "close").then(([code, signal]) => {
      exited = true;
      return { code, signal };
    });
    let roster;
    child.on("message", (r) => {
      roster = r;
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !roster && !exited) {
      if (child.connected) child.send("roster");
      await delay(100);
    }
    if (profile === "headless") {
      const result = await Promise.race([
        closed,
        timeout(20000).then(() => {
          throw new Error("headless timeout");
        }),
      ]);
      assert.equal(result.code, 0, output);
      assert.match(output, /COMBO_RC2_OK/);
      assert.equal(
        requests.filter((p) => p.endsWith("/tasks/claim")).length,
        before,
      );
      console.log(JSON.stringify({ profile, modelRound: true, worker: false }));
      continue;
    }
    assert.ok(roster && !roster.error, output + "\n" + JSON.stringify(roster));
    assert.ok(
      roster.tools.includes("mcp__agent-society__hub_context_read"),
      JSON.stringify(roster),
    );
    const worker = roster.entries.find(
      (e) => e.name === "@agent-society/dsh-agent-society/worker",
    );
    if (profile === "web") {
      assert.ok(!worker || worker.state === undefined, JSON.stringify(worker));
      let launch;
      while (
        Date.now() < deadline &&
        !(launch = /dsh web: (http:\/\/[^\s]+)/.exec(output)?.[1]) &&
        !exited
      )
        await delay(100);
      assert.ok(launch, output);
      const origin = new URL(launch).origin;
      const noAuth = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      assert.equal(noAuth.status, 401);
      const exchange = await fetch(launch, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      assert.equal(exchange.status, 303);
      const cookie = exchange.headers.get("set-cookie").split(";")[0];
      const page = await fetch(
        new URL(exchange.headers.get("location"), launch),
        { headers: { cookie }, signal: AbortSignal.timeout(5000) },
      );
      assert.equal(page.status, 200);
      assert.match(
        await page.text(),
        /@deepseek-ai\/dsh-client-modules\/client.js/,
      );
      assert.doesNotMatch(
        output,
        /HTML did not preload|plugin tree failed to load/,
      );
      assert.equal(
        requests.filter((p) => p.endsWith("/tasks/claim")).length,
        before,
      );
      console.log(
        JSON.stringify({
          profile,
          unauth: 401,
          exchange: 303,
          html: 200,
          preload: true,
          hubMcp: true,
          worker: false,
        }),
      );
    } else {
      assert.equal(worker?.state, 2, JSON.stringify(worker));
      while (Date.now() < deadline && !completed && !exited) await delay(100);
      assert.ok(completed, JSON.stringify({ output, requests, roster }));
      assert.equal(
        completed.result.text,
        "COMBO_RC2_OK",
        JSON.stringify(completed),
      );
      assert.equal(completed.result.model, "deepseek-flash");
      assert.ok(completed.result.dsh_transcript_artifact_id);
      console.log(
        JSON.stringify({
          profile,
          hubMcp: true,
          worker: true,
          task: "completed",
          model: completed.result.model,
          transcript: !!completed.result.dsh_transcript_artifact_id,
        }),
      );
    }
    child.send("stop");
    const result = await Promise.race([
      closed,
      timeout(10000).then(() => {
        throw new Error("shutdown timeout");
      }),
    ]);
    assert.equal(result.code, 0, output);
  }
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = once(child, "close");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 6000);
    try {
      await closed;
    } finally {
      clearTimeout(force);
    }
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(home, { recursive: true, force: true });
}
