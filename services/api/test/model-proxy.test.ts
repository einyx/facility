import { describe, expect, it } from "vitest";
import {
  allowlistedChatBody,
  mintModelProxyToken,
  redactModelProxyLog,
  verifyModelProxyToken,
} from "../src/model-proxy/proxy.js";

describe("model proxy", () => {
  it("rejects a token signed with another secret", () => {
    const token = mintModelProxyToken("ws_1", "one");
    expect(() => verifyModelProxyToken(token, "two")).toThrow(/invalid/);
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
