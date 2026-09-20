// Dedicated image service. Do not install this over the Telegram Bot API relay.
// Deploy in an OpenAI-supported region with an eligible organization/account.
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const RECOMMENDED_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
// gpt-image-2.5-flare/sunburst also accept a custom WIDTHxHEIGHT beyond the
// three recommended sizes - multiples of 16, aspect ratio between 1:3 and
// 3:1, neither edge over 3840px, total pixels between 655,360 and 8,294,400
// (OpenAI's documented constraints). Anything outside that, or malformed,
// falls back to the square default rather than sending OpenAI a request it
// would reject outright.
function resolveSize(value) {
  if (typeof value !== "string") return "1024x1024";
  if (RECOMMENDED_SIZES.has(value)) return value;
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) return "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 16 !== 0 || height % 16 !== 0) return "1024x1024";
  if (width > 3840 || height > 3840) return "1024x1024";
  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) return "1024x1024";
  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) return "1024x1024";
  return value;
}
const ALLOWED_QUALITY = new Set(["low", "medium", "high", "auto"]);
const ALLOWED_FORMAT = new Set(["png", "jpeg", "webp"]);
const ALLOWED_BACKGROUND = new Set(["auto", "transparent", "opaque"]);

export function imageService({ token, apiKey, model = "gpt-image-2.5-flare", providerFetch = fetch }) {
  const jobs = new Map(); let running = 0;
  const authorized = value => {
    if (!token || token.length < 32) return false;
    const actual = Buffer.from(value || ""); const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  return createServer(async (request, response) => {
    const reply = (status, body) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
    if (request.method === "GET" && request.url === "/health") return reply(apiKey && token?.length >= 32 ? 200 : 503, { ready: Boolean(apiKey && token?.length >= 32) });
    if (request.method !== "POST" || request.url !== "/generate") return reply(404, { error: "Not found" });
    if (!authorized(request.headers.authorization)) return reply(401, { error: "Unauthorized" });
    if (!apiKey) return reply(503, { error: "Image provider is not configured" });
    const id = request.headers["idempotency-key"];
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) return reply(400, { error: "Idempotency key required" });
    let body;
    const timer = setTimeout(() => request.destroy(), 10_000);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 64_000) { reply(413, { error: "Request too large" }); return; } chunks.push(chunk); }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return reply(400, { error: "Invalid request" }); }
    finally { clearTimeout(timer); }
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 12000) return reply(400, { error: "Invalid prompt" });
    const hash = createHash("sha256").update(body.prompt).digest("hex");
    const previous = jobs.get(id);
    if (previous && previous.hash !== hash) return reply(409, { error: "Request key already used" });
    if (!previous && running >= 2) return reply(429, { error: "Image service is busy" });
    if (!previous) {
      // Small, bounded cache; the main application owns durable request state.
      for (const [key, job] of jobs) if (jobs.size >= 8 && job.done) jobs.delete(key);
      const job = { hash, done: false, result: null };
      running++;
      job.result = (async () => {
        try {
          const resolvedSize = resolveSize(body.size);
          const quality = ALLOWED_QUALITY.has(body.quality) ? body.quality : "medium";
          const outputFormat = ALLOWED_FORMAT.has(body.output_format) ? body.output_format : "png";
          const background = ALLOWED_BACKGROUND.has(body.background) ? body.background : undefined;
          const upstream = await providerFetch("https://api.openai.com/v1/images/generations", {
            method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: body.prompt, n: 1, size: resolvedSize, quality, output_format: outputFormat, ...(background ? { background } : {}) }),
            signal: AbortSignal.timeout(150_000),
          });
          if (!upstream.ok) return { status: upstream.status === 400 ? 400 : 502, body: { error: "Image provider did not complete the request" } };
          const reader = upstream.body.getReader(); const chunks = []; let size = 0;
          try {
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 12_000_000) { await reader.cancel(); throw new Error("Image response too large"); } chunks.push(part.value); }
          } finally { reader.releaseLock(); }
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (typeof data.data?.[0]?.b64_json !== "string") throw new Error("Missing image");
          return { status: 200, body: { data: [{ b64_json: data.data[0].b64_json }], usage: data.usage } };
        } catch { return { status: 502, body: { error: "Image request failed" } }; }
        finally { running--; job.done = true; }
      })();
      jobs.set(id, job);
    }
    const result = await jobs.get(id).result;
    reply(result.status, result.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = imageService({ token: process.env.KLIO_IMAGE_SERVICE_TOKEN, apiKey: process.env.OPENAI_API_KEY, model: process.env.KLIO_IMAGE_MODEL });
  server.listen(Number(process.env.PORT || 10000), "0.0.0.0", () => console.log("KLIO image service listening"));
}
