import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000;

export type ModelProxyToken = { workspaceId: string; exp: number };

export type ModelProxyLog = {
  event: "model_proxy";
  workspaceId: string;
  model: string;
  status: number;
  bytes: number;
  durationMs: number;
};

export function mintModelProxyToken(workspaceId: string, secret: string, now = Date.now()) {
  const payload: ModelProxyToken = { workspaceId, exp: now + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyModelProxyToken(token: string, secret: string, now = Date.now()): ModelProxyToken {
  const [body, mac] = token.split(".");
  if (!body || !mac || !safeEqual(mac, sign(body, secret))) {
    throw new Error("model proxy token is invalid");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ModelProxyToken;
  if (!payload.workspaceId || payload.exp < now) throw new Error("model proxy token is expired");
  return payload;
}

export function allowlistedChatBody(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model proxy body is invalid");
  const value = raw as Record<string, unknown>;
  const model = value.model;
  const messages = value.messages;
  if (typeof model !== "string" || model.length === 0 || model.length > 160) {
    throw new Error("model proxy model is invalid");
  }
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("model proxy messages are required");
  return {
    model,
    messages,
    tools: value.tools,
    stream: false,
    think: value.think === true,
  };
}

export function redactModelProxyLog(input: Omit<ModelProxyLog, "event">): ModelProxyLog {
  return { event: "model_proxy", ...input };
}

export async function forwardModelChat(input: {
  upstream: string;
  body: ReturnType<typeof allowlistedChatBody>;
  fetchImpl?: typeof fetch;
}) {
  const response = await (input.fetchImpl ?? fetch)(`${input.upstream.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  });
  const text = await response.text();
  return { status: response.status, text };
}

export function ollamaUpstream(): string {
  const upstream = process.env.OLLAMA_UPSTREAM;
  if (!upstream) throw new Error("OLLAMA_UPSTREAM is required for the model proxy");
  return upstream.replace(/\/$/, "");
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
