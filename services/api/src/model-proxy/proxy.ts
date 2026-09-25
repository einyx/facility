import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const MAX_BODY_BYTES = 256 * 1024;
const TOKEN_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_OLLAMA_UPSTREAM = "http://192.168.190.237:11434";

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

export function startModelProxy(input: {
  port: number;
  secret: string;
  upstream?: string;
  onLog?: (line: ModelProxyLog) => void;
}) {
  const upstream = input.upstream ?? process.env.OLLAMA_UPSTREAM ?? DEFAULT_OLLAMA_UPSTREAM;
  const server = createServer(async (request, response) => {
    try {
      await handle(request, response, { ...input, upstream });
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "model proxy failed");
    }
  });
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    server.listen(input.port, "0.0.0.0", () => resolve(server));
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  input: { secret: string; upstream: string; onLog?: (line: ModelProxyLog) => void },
) {
  if (request.method !== "POST" || request.url !== "/v1/model-proxy/chat") {
    response.writeHead(404).end("not found");
    return;
  }
  const started = Date.now();
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let workspaceId = "unknown";
  try {
    workspaceId = verifyModelProxyToken(token, input.secret).workspaceId;
  } catch {
    response.writeHead(401).end("unauthorized");
    return;
  }
  const raw = await readBody(request);
  let body: ReturnType<typeof allowlistedChatBody>;
  try {
    body = allowlistedChatBody(JSON.parse(raw));
  } catch (error) {
    response.writeHead(400).end(error instanceof Error ? error.message : "invalid body");
    return;
  }
  const forwarded = await forwardModelChat({ upstream: input.upstream, body });
  input.onLog?.(
    redactModelProxyLog({
      workspaceId,
      model: body.model,
      status: forwarded.status,
      bytes: Buffer.byteLength(raw),
      durationMs: Date.now() - started,
    }),
  );
  response.writeHead(forwarded.status, { "content-type": "application/json" }).end(forwarded.text);
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("model proxy body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
