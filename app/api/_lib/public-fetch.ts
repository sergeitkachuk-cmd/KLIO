import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class PublicFetchError extends Error {
  constructor(message: string, readonly code: "blocked" | "size" | "timeout" | "response") { super(message); }
}

// Only globally routable IPv4 destinations are supported. IPv6 is rejected
// rather than relying on incomplete checks for mapped/tunnel/local ranges.
export function isPublicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

export function publicHttpUrl(value: string | URL): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password
    || (url.port && url.port !== "80" && url.port !== "443")
    || !hostname.includes(".") || /\.(localhost|local|internal|test|invalid)$/.test(hostname)
    || hostname.includes(":") || (isIP(hostname) && !isPublicIpv4(hostname))) {
    throw new PublicFetchError("External URL is not public.", "blocked");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

type FetchOptions = { maxBytes: number; timeoutMs: number; truncate?: boolean; accept?: string };
type PublicResponse = { status: number; ok: boolean; headers: Headers; url: string; bytes: Uint8Array; text: () => Promise<string> };

// Resolve and validate first, then pin the socket to that exact address.
// The original hostname remains in Host and TLS SNI/certificate validation.
// No cookies, authorization, proxy settings or caller-supplied headers pass
// through. Redirects share one deadline and repeat DNS/address validation.
export async function fetchPublicResource(input: string | URL, options: FetchOptions): Promise<PublicResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new PublicFetchError("External request timed out.", "timeout")), options.timeoutMs);
  const signal = controller.signal;
  try {
    let url = publicHttpUrl(input);
    for (let hop = 0; hop <= 5; hop++) {
      const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: 4 }] : await new Promise<LookupAddress[]>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        lookup(url.hostname, { family: 4, all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      if (!addresses.length || addresses.some(item => !isPublicIpv4(item.address))) throw new PublicFetchError("External hostname resolves to a non-public address.", "blocked");
      const address = addresses[0].address;
      const result = await new Promise<PublicResponse>((resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          agent: false, signal, family: 4,
          lookup: (_hostname, _options, callback) => callback(null, address, 4),
          headers: { Accept: options.accept || "*/*", "Accept-Encoding": "gzip, deflate, br", "User-Agent": "KLIO-Public-Resource/1.0" },
        }, response => {
          const status = response.statusCode || 502;
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const finish = (bytes: Uint8Array) => resolve({ status, ok: status >= 200 && status < 300, headers, url: url.toString(), bytes, text: async () => new TextDecoder().decode(bytes) });
          response.on("error", reject);
          if (status >= 300 && status < 400) { finish(new Uint8Array()); response.destroy(); return; }
          const encoding = headers.get("content-encoding")?.toLowerCase();
          const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
          if (encoding && encoding !== "identity" && !decoder) { reject(new PublicFetchError("Unsupported external encoding.", "response")); response.destroy(); return; }
          const stream = decoder ? response.pipe(decoder) : response;
          let rawBytes = 0;
          let decodedBytes = 0;
          const chunks: Buffer[] = [];
          let finished = false;
          const stop = () => { response.destroy(); decoder?.destroy(); };
          const tooLarge = () => { if (!finished) { finished = true; reject(new PublicFetchError("External response is too large.", "size")); stop(); } };
          response.on("data", (chunk: Buffer) => { rawBytes += chunk.length; if (rawBytes > options.maxBytes && decoder) tooLarge(); });
          stream.on("error", error => { reject(error); stop(); });
          stream.on("data", (chunk: Buffer) => {
            if (finished) return;
            const remaining = options.maxBytes - decodedBytes;
            if (chunk.length > remaining && !options.truncate) { tooLarge(); return; }
            chunks.push(chunk.subarray(0, remaining));
            decodedBytes += Math.min(chunk.length, remaining);
            if (decodedBytes >= options.maxBytes && options.truncate) {
              finished = true;
              finish(new Uint8Array(Buffer.concat(chunks)));
              stop();
            }
          });
          stream.on("end", () => { if (!finished) { finished = true; finish(new Uint8Array(Buffer.concat(chunks))); } });
        });
        request.on("error", reject);
        request.end();
      });
      if (result.status < 300 || result.status >= 400 || !result.headers.get("location")) return result;
      url = publicHttpUrl(new URL(result.headers.get("location")!, url));
    }
    throw new PublicFetchError("Too many external redirects.", "response");
  } finally { clearTimeout(timer); }
}
