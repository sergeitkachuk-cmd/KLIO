import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../app/feedback-sync.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (messages = [], extra = {}) => ({ messages, announcements: [], unreadRepliesCount: 0, unreadAnnouncementsCount: 0, ...extra });

function harness(fetcher, kind = "support") {
  const timers = new Map();
  let id = 0;
  const window = Object.assign(new EventTarget(), {
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: key => timers.delete(key),
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const exports = {};
  const calls = [], received = [];
  vm.runInNewContext(source, { exports, window, document, AbortController, fetch: async (url, init) => {
    assert.equal(url, "/api/feedback");
    calls.push(init);
    return fetcher(init, calls.length);
  } });
  const stop = exports.startFeedbackSync(data => received.push(data), kind);
  return { calls, received, stop, timers, window, document, async tick(delay) {
    const entry = [...timers].find(([, value]) => value.delay === delay);
    assert.ok(entry, `Missing scheduled refresh at ${delay}ms`);
    timers.delete(entry[0]); entry[1].callback(); await settle();
  } };
}

test("an open conversation receives new replies and deletions without a page reload", async () => {
  let messages = [{ id: "reply", sender: "admin", body: "Reply", createdAt: "2026-11-03" }];
  const h = harness(async () => Response.json(snapshot(messages)));
  await settle();
  assert.equal(h.received[0].messages.length, 1);
  messages = [...messages, { ...messages[0], id: "new-reply" }];
  await h.tick(3000);
  assert.equal(h.received.at(-1).messages.length, 2);
  messages = [messages[1]];
  await h.tick(3000);
  assert.deepEqual(Array.from(h.received.at(-1).messages, row => row.id), ["new-reply"]);
  h.stop(); assert.equal(h.timers.size, 0);
});

test("closed chats refresh badges without marking replies read; hidden tabs pause and resume", async () => {
  const h = harness(async () => Response.json(snapshot([], { unreadRepliesCount: 2 })), null);
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.received[0].unreadRepliesCount, 2);
  await h.tick(30000);
  h.document.visibilityState = "hidden";
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.timers.size, 0);
  h.window.dispatchEvent(new Event("focus")); await settle();
  assert.equal(h.calls.length, 2);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange")); await settle();
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(call => !call.method));
  h.stop();
});

test("only the open view is marked read, including replies arriving while it stays open", async () => {
  for (const kind of ["support", "news"]) {
    const h = harness(async init => init.method === "PATCH" ? Response.json({ ok: true }) : Response.json(snapshot([], { unreadRepliesCount: 1, unreadAnnouncementsCount: 2 })), kind);
    await settle(); await h.tick(3000);
    const patches = h.calls.filter(call => call.method === "PATCH");
    assert.equal(patches.length, 2);
    assert.ok(patches.every(call => JSON.parse(call.body).kind === kind));
    h.stop();
  }
});

test("network and HTTP failures preserve the conversation and retry", async () => {
  let attempt = 0;
  const h = harness(async () => {
    attempt++;
    if (attempt === 2) throw new Error("offline");
    if (attempt === 3) return Response.json({ error: "unavailable" }, { status: 502 });
    return Response.json(snapshot([{ id: String(attempt) }]));
  });
  await settle(); await h.tick(3000); await h.tick(3000);
  assert.equal(h.received.length, 1);
  await h.tick(3000);
  assert.equal(h.received.at(-1).messages[0].id, "4");
  h.stop();
});

test("focus cannot overlap requests, and cleanup ignores a late snapshot from before a send", async () => {
  let resolve;
  const h = harness(() => new Promise(done => { resolve = done; }));
  h.window.dispatchEvent(new Event("focus"));
  h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.calls.length, 1);
  h.stop();
  assert.equal(h.calls[0].signal.aborted, true);
  resolve(Response.json(snapshot([{ id: "stale" }]))); await settle();
  assert.equal(h.received.length, 0);
  assert.equal(h.timers.size, 0);
  h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.calls.length, 1);
});

test("a stalled request times out and polling recovers", async () => {
  const h = harness((init, attempt) => attempt === 1 ? new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("timeout")));
  }) : Response.json(snapshot()));
  await h.tick(10000);
  assert.equal(h.calls[0].signal.aborted, true);
  await h.tick(3000);
  assert.equal(h.received.length, 1);
  h.stop();
});
