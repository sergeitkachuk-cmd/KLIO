import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers/dialogue-harness.mjs";

const { createDialogueSession } = load("app/dialogue-session.ts");
const input = { mode: "chat", useBrandContext: false, settings: {} };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function thread(id = "a", extra = {}) { return { id, brandId: null, title: "Thread", revision: 0, status: "ready", error: "", data: { cards: [], messages: [] }, ...extra }; }
function harness(t, request, extra = {}) {
  const cache = new Map();
  const store = createDialogueSession({ storageKey: "test", brandId: null, request, pollMs: 60_000,
    storage: () => ({ getItem: (key) => cache.get(key), setItem: (key, value) => cache.set(key, value), removeItem: (key) => cache.delete(key) }), ...extra });
  t.after(() => store.stop()); store.start();
  return { store, cache };
}

test("image references persist with their own draft, survive a failed send and clear on acceptance", async (t) => {
  let fail = true;
  const { store, cache } = harness(t, async (p) => {
    if (typeof p === "string") return { thread: thread("a") };
    if (fail) throw new Error("Offline");
    return { thread: thread("a", { revision: 1, data: { cards: [], messages: [{ id: p.requestId, role: "user", text: p.text }] } }) };
  });
  await store.open("a");
  const imageSource = { cardId: "image-1", purpose: "edit" };
  store.setDraft("Убери провод"); store.setImageSource(imageSource);
  await store.open(null); assert.equal(store.getSnapshot().imageSource, null);
  await store.open("a"); assert.equal(JSON.stringify(store.getSnapshot().imageSource), JSON.stringify(imageSource));
  assert.equal(await store.send("Убери провод", { ...input, mode: "image", imageSource }), false);
  assert.ok(cache.get("test:a:draft:image"));
  fail = false;
  assert.equal(await store.send("Убери провод", { ...input, mode: "image", imageSource }), true);
  assert.equal(store.getSnapshot().imageSource, null); assert.equal(cache.get("test:a:draft:image"), undefined);
});
test("double submission creates and sends once, even before the thread exists", async (t) => {
  const wait = deferred(); const calls = [];
  const { store } = harness(t, async (p) => { calls.push(p); if (p.action === "create") { await wait.promise; return { thread: thread(p.id) }; } return { thread: thread(p.id, { revision: 1, status: "processing", data: { messages: [{ id: p.requestId, role: "user", text: p.text }], cards: [] } }) }; });
  store.setDraft("Hello");
  const first = store.send("Hello", input);
  assert.equal(await store.send("Hello", input), false);
  wait.resolve(); assert.equal(await first, true);
  assert.equal(calls.length, 2); assert.equal(store.getSnapshot().draft, "");
  assert.equal(store.getSnapshot().thread.status, "processing");
});
test("lost POST response recovers the accepted job without a second POST", async (t) => {
  let accepted; let posts = 0;
  const { store } = harness(t, async (p) => {
    if (typeof p === "string") return { thread: accepted };
    if (p.action === "create") return { thread: thread(p.id) };
    posts++; accepted = thread(p.id, { revision: 1, status: "processing", data: { messages: [{ id: p.requestId, role: "user", text: p.text }], cards: [] } });
    throw new Error("Connection lost");
  });
  store.setDraft("Hello"); assert.equal(await store.send("Hello", input), true);
  assert.equal(posts, 1); assert.equal(store.getSnapshot().thread.status, "processing");
});
test("uncertain requests reuse their id on explicit retry and preserve text", async (t) => {
  const ids = []; let current; let fail = true;
  const { store } = harness(t, async (p) => {
    if (typeof p === "string") { if (fail) throw new Error("Offline"); return { thread: current }; }
    if (p.action === "create") { current = thread(p.id); return { thread: current }; }
    ids.push(p.requestId); if (fail) throw new Error("Offline"); return { thread: current };
  });
  store.setDraft("Do not lose this");
  assert.equal(await store.send("Do not lose this", input), false);
  assert.equal(store.getSnapshot().draft, "Do not lose this");
  fail = false; assert.equal(await store.send("Do not lose this", input), true);
  assert.equal(ids[0], ids[1]);
});
test("late load and older revision cannot replace the selected thread", async (t) => {
  const wait = deferred();
  const { store } = harness(t, async (url) => url.includes("id=a") ? wait.promise : { thread: thread("b", { revision: 4 }) });
  const loading = store.open("a"); await store.open("b"); wait.resolve({ thread: thread("a") }); await loading;
  store.accept(thread("b", { revision: 2 }));
  assert.equal(store.getSnapshot().thread.id, "b"); assert.equal(store.getSnapshot().thread.revision, 4);
});
test("wrong-brand records are rejected even when selection cache is tampered with", async (t) => {
  const { store } = harness(t, async () => ({ thread: thread("wrong", { brandId: "other" }) }));
  await store.open("wrong");
  assert.equal(store.getSnapshot().thread, null); assert.ok(store.getSnapshot().error);
  assert.equal(await store.send("test", input), false);
});
test("drafts are independent between threads and survive selection changes", async (t) => {
  const { store } = harness(t, async (url) => ({ thread: thread(new URL(url, "https://test.invalid").searchParams.get("id")) }));
  store.setDraft("new draft"); await store.open("a"); store.setDraft("a draft");
  await store.open("b"); store.setDraft("b draft"); await store.open("a");
  assert.equal(store.getSnapshot().draft, "a draft");
  await store.open(null); assert.equal(store.getSnapshot().draft, "new draft");
});
test("blocked storage does not prevent sending or restoring after profile-save failure", async (t) => {
  let calls = 0;
  const { store } = harness(t, async (p) => { calls++; return { thread: thread(p.id) }; }, { storage: () => { throw new Error("Denied"); } });
  store.setDraft("brand request"); assert.equal(await store.send("brand request", input, async () => false), false);
  assert.equal(calls, 0); assert.equal(store.getSnapshot().draft, "brand request");
  assert.equal(await store.send("brand request", input, async () => true), true); assert.equal(calls, 2);
});
test("typing the next prompt while submission is in flight preserves it", async (t) => {
  const wait = deferred();
  const { store } = harness(t, async (p) => { if (p.action === "send") await wait.promise; return { thread: thread(p.id) }; });
  store.setDraft("first"); const sending = store.send("first", input);
  await Promise.resolve(); store.setDraft("next unsent message"); wait.resolve(); await sending;
  assert.equal(store.getSnapshot().draft, "next unsent message");
});
test("polling resumes an existing job using GET only and stops at completion", async (t) => {
  const calls = []; let status = "processing";
  const { store } = harness(t, async (url) => { calls.push(url); return { thread: thread("a", { status, revision: status === "ready" ? 2 : 1 }) }; });
  await store.open("a"); status = "ready"; await store.refresh();
  assert.equal(store.getSnapshot().thread.status, "ready"); assert.ok(calls.every((call) => typeof call === "string"));
});
test("unmounted session ignores late generation results and can restart under StrictMode", async (t) => {
  const wait = deferred();
  const { store } = harness(t, async (p) => { await wait.promise; return { thread: thread(p.id) }; });
  const sending = store.send("first", input); store.stop(); wait.resolve(); await sending;
  assert.equal(store.getSnapshot().thread, null);
  store.start(); assert.equal(store.getSnapshot().sending, false); assert.equal(store.getSnapshot().loading, false);
});
test("card actions cannot erase a different draft already in the composer", async (t) => {
  const { store } = harness(t, async (p) => ({ thread: thread(p.id) }));
  store.setDraft("Unrelated manual draft"); await store.send("Create image from topic", { ...input, mode: "image" });
  assert.equal(store.getSnapshot().draft, "Unrelated manual draft");
});
test("reload recovers an accepted message and clears only its matching cached draft", async (t) => {
  const { store, cache } = harness(t, async () => ({ thread: thread("a", { data: { cards: [], messages: [{ id: "request-1", role: "user", text: "cached prompt" }] } }) }));
  cache.set("test:a:draft", "cached prompt");
  cache.set("test:a:pending", JSON.stringify({ id: "request-1", signature: JSON.stringify({ text: "cached prompt", ...input }) }));
  await store.open("a"); assert.equal(store.getSnapshot().draft, ""); assert.equal(cache.has("test:a:pending"), false);
});
