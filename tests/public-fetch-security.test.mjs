import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import * as zlib from "node:zlib";
import vm from "node:vm";
import ts from "typescript";

function harness({ addresses = ["93.184.215.14"], replies = [{}], dnsDelay = 0 } = {}) {
  let dnsCalls = 0;
  const sockets = [];
  const dependencies = {
    "node:net": net, "node:zlib": zlib,
    "node:dns/promises": { lookup: async () => { dnsCalls++; if (dnsDelay) await new Promise(resolve => setTimeout(resolve, dnsDelay)); return addresses.map(address => ({ address, family: 4 })); } },
  };
  const request = (url, options, callback) => {
    const reply = replies[sockets.length] || {};
    sockets.push({ url: url.toString(), options });
    const req = new EventEmitter();
    const response = new PassThrough();
    response.statusCode = reply.status || 200;
    response.headers = reply.headers || {};
    const abort = () => { response.destroy(); req.emit("error", options.signal.reason); };
    options.signal.addEventListener("abort", abort, { once: true });
    response.on("close", () => options.signal.removeEventListener("abort", abort));
    req.end = () => { setTimeout(() => {
      if (options.signal.aborted) return;
      callback(response);
      if (!reply.stall) response.end(reply.body || "hello");
    }, reply.delay || 0); };
    return req;
  };
  dependencies["node:http"] = dependencies["node:https"] = { request };
  const source = readFileSync(new URL("../app/api/_lib/public-fetch.ts", import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, URL, Headers, AbortController, TextDecoder, setTimeout, clearTimeout,
    require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
  });
  return { ...exports, sockets, dnsCalls: () => dnsCalls, fetch: (url = "https://example.com", options = {}) => exports.fetchPublicResource(url, { maxBytes: 100, timeoutMs: 1000, ...options }) };
}

test("rejects loopback, private, metadata, mapped IPv6 and non-web URLs before connection", async () => {
  const h = harness();
  for (const url of ["http://127.1", "http://2130706433", "http://0x7f000001", "http://10.0.0.1", "http://169.254.169.254", "http://100.64.0.1", "http://198.18.0.1", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "https://example.com:5432", "https://user:pass@example.com"]) {
    await assert.rejects(h.fetch(url), error => error.code === "blocked");
  }
  assert.equal(h.sockets.length, 0);
});

test("DNS private and mixed public/private answers are blocked", async () => {
  for (const addresses of [["127.0.0.1"], ["93.184.215.14", "192.168.1.1"]]) {
    const h = harness({ addresses });
    await assert.rejects(h.fetch(), error => error.code === "blocked");
    assert.equal(h.sockets.length, 0);
  }
});

test("socket uses the validated IP while retaining hostname and disabling reuse", async () => {
  const h = harness();
  assert.equal(await (await h.fetch()).text(), "hello");
  const { url, options } = h.sockets[0];
  assert.equal(url, "https://example.com/");
  assert.equal(options.agent, false);
  options.lookup("example.com", {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, "93.184.215.14"); assert.equal(family, 4);
  });
  assert.equal(h.dnsCalls(), 1);
});

test("redirect to an internal destination never opens another socket", async () => {
  const h = harness({ replies: [{ status: 302, headers: { location: "http://169.254.169.254/latest" } }] });
  await assert.rejects(h.fetch(), error => error.code === "blocked");
  assert.equal(h.sockets.length, 1);
});

test("oversized plain and decompressed bodies fail without retaining the whole response", async () => {
  for (const reply of [{ body: "a".repeat(1000) }, { body: zlib.gzipSync("a".repeat(10000)), headers: { "content-encoding": "gzip" } }]) {
    await assert.rejects(harness({ replies: [reply] }).fetch(), error => error.code === "size");
  }
});

test("HTML may retain a bounded prefix instead of discarding useful content", async () => {
  const response = await harness({ replies: [{ body: "a".repeat(1000) }] }).fetch(undefined, { truncate: true });
  assert.equal(response.bytes.length, 100);
  assert.equal((await response.text()).length, 100);
});

test("stalled body and stalled DNS obey the deadline", async () => {
  for (const h of [harness({ replies: [{ stall: true }] }), harness({ dnsDelay: 50 })]) {
    await assert.rejects(h.fetch(undefined, { timeoutMs: 15 }), error => error.code === "timeout");
  }
});

test("redirect chain shares a single deadline", async () => {
  const h = harness({ replies: [{ status: 302, headers: { location: "/next" }, delay: 10 }, { delay: 30 }] });
  await assert.rejects(h.fetch(undefined, { timeoutMs: 25 }), error => error.code === "timeout");
});
