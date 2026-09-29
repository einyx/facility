import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentManifest } from "@facility/agents";
import { afterEach, describe, expect, it } from "vitest";
import { type FacilityPlugin, loadPlugins, type PluginEngine } from "../src/plugin.js";
import { AgentEngineRegistry, ClaudeCodeEngine, PluginCliEngine } from "../src/turns/engines.js";
import type {
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceLocator,
  WorkspaceRuntime,
} from "../src/workspaces/runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function pluginFile(source: string) {
  const root = await mkdtemp(join(tmpdir(), "facility-plugin-"));
  roots.push(root);
  const file = join(root, "plugin.mjs");
  await writeFile(file, source);
  return file;
}

const VALID = `export default {
  apiVersion: 1,
  name: "echo",
  engines: {
    echo_cli: {
      command: "echo-cli",
      args: ({ prompt, model }) => ["--model", model, prompt],
      parser: () => ({ accept: () => [], result: () => ({ output: "", progress: [], events: [] }) }),
    },
  },
};`;

describe("loadPlugins", () => {
  it("loads a valid plugin from an absolute path", async () => {
    const [plugin] = await loadPlugins([await pluginFile(VALID)]);
    expect(plugin?.name).toBe("echo");
    expect(Object.keys(plugin?.engines ?? {})).toEqual(["echo_cli"]);
  });

  it("returns nothing when no paths are configured", async () => {
    expect(await loadPlugins([])).toEqual([]);
  });

  it.each([
    ["missing default export", "export const x = 1;", "default"],
    ["wrong apiVersion", VALID.replace("apiVersion: 1", "apiVersion: 2"), "apiVersion"],
    ["bad engine name", VALID.replace("echo_cli:", '"Echo-Cli":'), "engines"],
    ["non-function args", VALID.replace(/args: .*,\n/, 'args: "nope",\n'), "args"],
  ])("rejects a plugin with %s and names its path", async (_label, source, field) => {
    const file = await pluginFile(source);
    await expect(loadPlugins([file])).rejects.toThrow(
      new RegExp(`plugin ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is invalid: .*${field}`),
    );
  });

  it("reports an import failure with the plugin path", async () => {
    await expect(loadPlugins(["/nonexistent/facility-plugin.mjs"])).rejects.toThrow(
      "plugin /nonexistent/facility-plugin.mjs failed to load",
    );
  });
});

const workspace: WorkspaceLocator = {
  id: "ws_0123456789abcdef",
  image: "facility-runner:test",
  externalRef: "ws_0123456789abcdef",
  volumeRef: "volume",
};

class EngineRuntime implements WorkspaceRuntime {
  readonly provider = "fake" as const;
  command?: WorkspaceCommand;
  constructor(private readonly result: WorkspaceCommandResult) {}
  async exec(_workspace: WorkspaceLocator, command: WorkspaceCommand) {
    this.command = command;
    const middle = Math.floor(this.result.stdout.length / 2);
    for (const data of [this.result.stdout.slice(0, middle), this.result.stdout.slice(middle)])
      command.onOutput?.({ stream: "stdout", data });
    return this.result;
  }
  create(): never {
    throw new Error("not used");
  }
  wake(): never {
    throw new Error("not used");
  }
  expose(): never {
    throw new Error("not used");
  }
  inspect(): never {
    throw new Error("not used");
  }
  suspend(): never {
    throw new Error("not used");
  }
  destroy(): never {
    throw new Error("not used");
  }
}

const echoPlugin: FacilityPlugin = {
  apiVersion: 1,
  name: "echo",
  engines: {
    echo_cli: {
      command: "echo-cli",
      args: ({ prompt, model, nativeSessionId }) => [
        "--model",
        model,
        ...(nativeSessionId ? ["--resume", nativeSessionId] : []),
        prompt,
      ],
      parser: () => {
        let sessionId: string | undefined;
        let output = "";
        return {
          accept(event) {
            if (typeof event.session === "string") sessionId = event.session;
            if (typeof event.text === "string") output = event.text;
            return [{ engine: "ignored", type: String(event.type), data: event }];
          },
          result: () => ({ sessionId, output, progress: [], events: [] }),
        };
      },
    },
  },
};

const echoEngine = echoPlugin.engines.echo_cli as PluginEngine;

function run(stdout: string, exitCode = 0, nativeSessionId?: string) {
  const runtime = new EngineRuntime({
    exitCode,
    stdout,
    stderr: exitCode ? "boom" : "",
    durationMs: 5,
  });
  const engine = new PluginCliEngine(runtime, "echo_cli", echoEngine);
  const manifest = parseAgentManifest(
    `---
name: echoer
description: Test agent.
engine: echo_cli
model: echo-1
triggers:
  - type: manual
---
Test prompt.
`,
    "echoer.md",
  );
  const streamed: string[] = [];
  const result = engine.run({
    turnId: "turn_test",
    manifest,
    workspace,
    prompt: "hello",
    cwd: "/workspace",
    nativeSessionId,
    onEvent: (event) => streamed.push(`${event.engine}:${event.type}`),
  });
  return { runtime, result, streamed };
}

describe("PluginCliEngine", () => {
  it("runs the plugin command through the engine wrapper and parses its JSONL", async () => {
    const { runtime, result, streamed } = run(
      '{"type":"start","session":"s1"}\n{"type":"done","text":"hi there"}\n',
      0,
      "s0",
    );
    const turn = await result;
    expect(runtime.command?.args?.slice(3)).toEqual([
      "echo-cli",
      "--model",
      "echo-1",
      "--resume",
      "s0",
      "hello",
    ]);
    expect(turn.nativeSessionId).toBe("s1");
    expect(turn.output).toBe("hi there");
    expect(turn.events.map((event) => `${event.engine}:${event.type}`)).toEqual([
      "echo_cli:start",
      "echo_cli:done",
    ]);
    expect(streamed).toEqual(["echo_cli:start", "echo_cli:done"]);
  });

  it("maps a non-zero exit to agent_engine_failed", async () => {
    await expect(run('{"type":"start","session":"s1"}\n', 2).result).rejects.toMatchObject({
      code: "agent_engine_failed",
    });
  });

  it("requires the plugin to report a session id", async () => {
    await expect(run('{"type":"done","text":"x"}\n').result).rejects.toMatchObject({
      code: "agent_session_missing",
    });
  });

  it("rejects non-JSONL output", async () => {
    await expect(run("not json\n").result).rejects.toMatchObject({
      code: "agent_observation_failed",
    });
  });
});

describe("AgentEngineRegistry", () => {
  const runtime = new EngineRuntime({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 });

  it("resolves plugin engines by name", () => {
    const registry = new AgentEngineRegistry([
      new ClaudeCodeEngine(runtime),
      new PluginCliEngine(runtime, "echo_cli", echoEngine),
    ]);
    expect(registry.get("echo_cli").name).toBe("echo_cli");
  });

  it("refuses a plugin engine that shadows a built-in", () => {
    expect(
      () =>
        new AgentEngineRegistry([
          new ClaudeCodeEngine(runtime),
          new PluginCliEngine(runtime, "claude_code", echoEngine),
        ]),
    ).toThrow(expect.objectContaining({ code: "agent_engine_duplicate" }));
  });
});

describe("manifest engine names", () => {
  const source = (engine: string) => `---
name: echoer
description: Test agent.
engine: ${engine}
model: m
triggers:
  - type: manual
---
Prompt.
`;
  it("accepts plugin engine names", () => {
    expect(parseAgentManifest(source("my_engine"), "echoer.md").engine).toBe("my_engine");
  });
  it("rejects malformed engine names", () => {
    expect(() => parseAgentManifest(source("Bad-Name"), "echoer.md")).toThrow();
  });
});
