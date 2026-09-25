import type { FastifyInstance } from "fastify";
import {
  allowlistedChatBody,
  forwardModelChat,
  ollamaUpstream,
  redactModelProxyLog,
  verifyModelProxyToken,
} from "../../model-proxy/proxy.js";
import type { AppConfig } from "../../types.js";

export async function registerModelProxyRoutes(app: FastifyInstance, config: AppConfig) {
  app.post(
    "/v1/model-proxy/chat",
    { config: { public: true }, bodyLimit: 256 * 1024 },
    async (request, reply) => {
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      let workspaceId: string;
      try {
        workspaceId = verifyModelProxyToken(token, config.secretMasterKey).workspaceId;
      } catch {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } });
      }
      let body: ReturnType<typeof allowlistedChatBody>;
      try {
        body = allowlistedChatBody(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: { code: "invalid_body", message: error instanceof Error ? error.message : "invalid body" },
        });
      }
      const started = Date.now();
      let upstream: string;
      try {
        upstream = ollamaUpstream();
      } catch {
        return reply.status(503).send({
          error: { code: "model_proxy_unconfigured", message: "OLLAMA_UPSTREAM is not configured" },
        });
      }
      const forwarded = await forwardModelChat({ upstream, body });
      request.log.info(
        redactModelProxyLog({
          workspaceId,
          model: body.model,
          status: forwarded.status,
          bytes: Buffer.byteLength(JSON.stringify(body)),
          durationMs: Date.now() - started,
        }),
      );
      return reply.status(forwarded.status).type("application/json").send(forwarded.text);
    },
  );
}
