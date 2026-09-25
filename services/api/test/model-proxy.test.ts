import { describe, expect, it } from "vitest";
import {
  allowlistedChatBody,
  mintModelProxyToken,
  ollamaUpstream,
  redactModelProxyLog,
  verifyModelProxyToken,
} from "../src/model-proxy/proxy.js";

describe("model proxy", () => {
  it("rejects a token signed with another secret", () => {
    const token = mintModelProxyToken("ws_1", "one");
    expect(() => verifyModelProxyToken(token, "two")).toThrow(/invalid/);
  });

  it("requires OLLAMA_UPSTREAM instead of a hardcoded default", () => {
    const previous = process.env.OLLAMA_UPSTREAM;
    delete process.env.OLLAMA_UPSTREAM;
    expect(() => ollamaUpstream()).toThrow(/OLLAMA_UPSTREAM/);
    process.env.OLLAMA_UPSTREAM = "http://ollama.internal:11434/";
    expect(ollamaUpstream()).toBe("http://ollama.internal:11434");
    if (previous === undefined) delete process.env.OLLAMA_UPSTREAM;
    else process.env.OLLAMA_UPSTREAM = previous;
  });

  it("drops upstream fields from the agent body", () => {
    expect(
      allowlistedChatBody({
        model: "qwen3:8b",
        messages: [{ role: "user", content: "secret prompt" }],
        host: "http://evil.example",
        tools: [],
      }),
    ).toEqual({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "secret prompt" }],
      tools: [],
      stream: false,
      think: false,
    });
  });

  it("logs model and workspace without the prompt", () => {
    const line = redactModelProxyLog({
      workspaceId: "ws_1",
      model: "qwen3:8b",
      status: 200,
      bytes: 40,
      durationMs: 12,
    });
    expect(JSON.stringify(line)).not.toContain("secret");
    expect(line).toMatchObject({ event: "model_proxy", workspaceId: "ws_1", model: "qwen3:8b" });
  });
});
