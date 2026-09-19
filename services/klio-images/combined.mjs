import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { imageService } from "./server.mjs";

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function forwardedHeaders(headers) {
  const blocked = new Set([...hopHeaders, ...String(headers.connection || "").toLowerCase().split(",").map(value => value.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

// One public port; Bot API paths retain their body, method and query string.
// The upstream host is fixed to loopback, never supplied by the caller.
export function combinedService({ telegramPort = 18081, ...imageOptions }) {
  const server = imageService(imageOptions);
  const imageHandler = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    if (request.method === "GET" && request.url === "/health/telegram") {
      const socket = connect({ host: "127.0.0.1", port: telegramPort });
      let finished = false;
      const finish = ready => {
        if (finished) return;
        finished = true; socket.destroy();
        response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ready }));
      };
      socket.setTimeout(2000, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      return;
    }
    if (!/^\/(?:file\/)?bot[^/\s?]+\//.test(request.url || "")) return imageHandler(request, response);
    const headers = forwardedHeaders(request.headers);
    delete headers.authorization;
    headers.host = `127.0.0.1:${telegramPort}`;
    const upstream = httpRequest({ host: "127.0.0.1", port: telegramPort, method: request.method, path: request.url, headers }, incoming => {
      response.writeHead(incoming.statusCode || 502, forwardedHeaders(incoming.headers));
      incoming.on("error", () => response.destroy());
      incoming.pipe(response);
    });
    upstream.setTimeout(180_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (response.headersSent) return response.destroy();
      response.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: false, error_code: 502, description: "Telegram service unavailable" }));
    });
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || process.env.TELEGRAM_HTTP_PORT || 8081);
  const telegramPort = port === 18081 ? 18082 : 18081;
  // Keep upstream's established directories, identity, flags and credentials.
  // Only the listener moves behind the shared public HTTP entry point.
  const childEnv = { ...process.env, TELEGRAM_HTTP_PORT: String(telegramPort), TELEGRAM_HTTP_IP_ADDRESS: "127.0.0.1" };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.KLIO_IMAGE_SERVICE_TOKEN;
  const child = spawn("/docker-entrypoint.sh", [], { env: childEnv, stdio: ["ignore", "ignore", "ignore"] });
  const server = combinedService({ telegramPort, token: process.env.KLIO_IMAGE_SERVICE_TOKEN, apiKey: process.env.OPENAI_API_KEY, model: process.env.KLIO_IMAGE_MODEL });
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    server.close();
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); process.exit(code); }, 10_000).unref();
    child.once("exit", () => process.exit(code));
  };
  child.on("error", () => { console.error("Telegram process could not start"); stop(1); });
  child.on("exit", () => { if (!stopping) { console.error("Telegram process exited"); server.close(); process.exit(1); } });
  server.on("error", () => { console.error("Shared listener could not start"); stop(1); });
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
  server.listen(port, "0.0.0.0", () => console.log("KLIO shared relay listening"));
}
