/**
 * U007 — in-process OpenAI-compatible LM Studio fixture on 127.0.0.1:0.
 * Deterministic models/chat/JSON/error/timeout contracts; no external LM.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type LmStudioFixture = {
  baseUrl: string;
  port: number;
  host: string;
  close: () => Promise<void>;
  listenerCount: () => number;
};

/**
 * Start a loopback OpenAI-compatible server.
 * Routes:
 * - GET /v1/models
 * - POST /v1/chat/completions (text or JSON mode)
 * - optional delay via header x-fixture-delay-ms
 * - error via header x-fixture-error: 1
 */
export async function startLmStudioFixture(): Promise<LmStudioFixture> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const delayMs = Number(req.headers["x-fixture-delay-ms"] ?? 0);
    const forceError = req.headers["x-fixture-error"] === "1";

    const respond = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    const handle = () => {
      if (forceError) {
        respond(500, { error: { message: "fixture error", type: "server_error" } });
        return;
      }

      if (req.method === "GET" && (url === "/v1/models" || url.startsWith("/v1/models?"))) {
        respond(200, {
          object: "list",
          data: [{ id: "fixture-model", object: "model", owned_by: "fixture" }],
        });
        return;
      }

      if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (c) => {
          raw += c;
        });
        req.on("end", () => {
          let wantJson = false;
          try {
            const parsed = JSON.parse(raw || "{}") as {
              response_format?: { type?: string };
              messages?: Array<{ content?: string }>;
            };
            wantJson =
              parsed.response_format?.type === "json_object" ||
              (parsed.messages ?? []).some((m) =>
                /json/i.test(String(m.content ?? "")),
              );
          } catch {
            // ignore
          }
          const content = wantJson
            ? JSON.stringify({ greeting: "hello" })
            : "hello";
          respond(200, {
            id: "chatcmpl-fixture",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        });
        return;
      }

      // health-ish
      if (req.method === "GET" && (url === "/" || url === "/health" || url === "/v1")) {
        respond(200, { ok: true });
        return;
      }

      respond(404, { error: { message: `no route ${url}` } });
    };

    if (delayMs > 0) {
      setTimeout(handle, delayMs);
    } else {
      handle();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const host = "127.0.0.1";
  const port = addr.port;
  const baseUrl = `http://${host}:${port}/v1`;

  return {
    baseUrl,
    port,
    host,
    listenerCount: () => server.listeners("request").length,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
