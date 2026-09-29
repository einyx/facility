import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentEngineNameSchema, type AgentManifest } from "@facility/agents";
import { z } from "zod";
import type { AgentTurnEvent, ParsedEngineEvents } from "./turns/engines.js";

export const PLUGIN_API_VERSION = 1;

export type PluginEngineArgsInput = {
  prompt: string;
  model: string;
  nativeSessionId?: string;
  options: AgentManifest["options"];
};

export type PluginEventParser = {
  /** Called once per JSONL object the command prints; return the events to record. */
  accept(event: Record<string, unknown>): AgentTurnEvent[] | undefined;
  result(): ParsedEngineEvents;
};

export type PluginEngine = {
  command: string;
  args(input: PluginEngineArgsInput): string[];
  /** Called once per turn. */
  parser(): PluginEventParser;
};

/**
 * Operator-installed extension. Plugins run in-process with the API and worker's
 * privileges; only load code you trust.
 */
export type FacilityPlugin = {
  apiVersion: typeof PLUGIN_API_VERSION;
  name: string;
  engines: Record<string, PluginEngine>;
};

const Fn = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function", {
  message: "must be a function",
});

const PluginEngineSchema = z.object({
  command: z.string().min(1),
  args: Fn,
  parser: Fn,
});

const FacilityPluginSchema = z.object({
  apiVersion: z.literal(PLUGIN_API_VERSION),
  name: z.string().min(1),
  engines: z.record(AgentEngineNameSchema, PluginEngineSchema),
});

export async function loadPlugins(paths: string[]): Promise<FacilityPlugin[]> {
  const plugins: FacilityPlugin[] = [];
  for (const path of paths) {
    const specifier =
      isAbsolute(path) || path.startsWith(".") ? pathToFileURL(resolve(path)).href : path;
    let mod: { default?: unknown };
    try {
      mod = await import(specifier);
    } catch (error) {
      throw new Error(
        `plugin ${path} failed to load: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = FacilityPluginSchema.safeParse(mod.default);
    if (!parsed.success) {
      throw new Error(
        `plugin ${path} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "default"}: ${i.message}`).join("; ")}`,
      );
    }
    plugins.push(mod.default as FacilityPlugin);
  }
  return plugins;
}
