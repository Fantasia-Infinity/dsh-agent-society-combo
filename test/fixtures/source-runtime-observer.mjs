import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { LlmAdapter } = await import(
  pathToFileURL(
    process.env.COMBO_SMOKE_LLM_MODULE || join(process.env.COMBO_SMOKE_HARNESS, "packages/llm/llm/lib/index.js"),
  ).href
);
export const name = "combo-smoke-observer";
export const inject = ["loader", "llm", "tools"];
export function apply(ctx) {
  ctx.logger.exporter({
    levels: { default: 2 },
    export: ({ type, args }) => {
      if (type === "warn" || type === "error") console.error(type, ...args);
    },
  });
  class Mock extends LlmAdapter {
    async *stream(options) {
      if (options.model !== "deepseek-flash")
        throw new Error("Unexpected default model: " + options.model);
      if (
        process.env.COMBO_SMOKE_EXPECT_HUB !== '0' &&
        options.messages.some((message) =>
          message.content.some(
            (block) =>
              block.type === "text" && block.text === "Say COMBO_RC2_OK",
          ),
        ) &&
        !options.tools.some(
          (tool) => tool.name === "mcp__agent-society__hub_context_read",
        )
      ) {
        throw new Error("Headless request is missing its Hub MCP tool");
      }
      const text = "COMBO_RC2_OK";
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text };
      yield { type: "block-end", index: 0, block: { type: "text", text } };
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: 3 } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  ctx.llm.registerAdapter(["combo-mock"], new Mock());
  const receive = async (command) => {
    if (command === "stop") return process.emit("SIGTERM");
    if (command !== "roster") return;
    try {
      await ctx.loader.await();
      const entries = [...ctx.loader.entries()].map((e) => ({
        id: e.id,
        name: e.options.name,
        state: e.fiber?.state,
      }));
      const tools = ctx.tools.schemas().map((t) => t.name);
      const active = [...ctx.loader.entries()];
      const compression = active.find(e=>e.options.name==='@deepseek-ai/dsh-session-persistence-jsonl')?.fiber?.config?.compression;
      const sandboxMode = active.find(e=>e.options.name==='@deepseek-ai/dsh-sandbox-policy')?.fiber?.config?.mode;
      const plugins = [...ctx.registry.values()].flatMap(runtime=>[...runtime.fibers].map(fiber=>({name:runtime.name,owner:fiber.entry?.options.name,state:fiber.state})));
      const importErrors=[];
      for (const entry of active.filter(e=>['dsh-codex-subscription','dsh-ssh-remote'].includes(e.options.name) && !e.fiber)) {
        try { await entry.parent.tree.import(entry.options.name, entry.getOuterStack); }
        catch(error) { importErrors.push({name:entry.options.name,message:error.message,stack:error.stack?.slice(0,1800)}); }
      }
      process.send({ entries, tools, compression, sandboxMode, plugins, importErrors });
    } catch (e) {
      process.send({ error: e.stack });
    }
  };
  ctx.effect(() => {
    process.on("message", receive);
    return () => process.off("message", receive);
  });
}
