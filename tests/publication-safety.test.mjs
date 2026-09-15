import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";

function load(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, Buffer, AbortSignal, URLSearchParams, console: { error() {} }, ...globals,
    require: name => { if (!(name in deps)) throw new Error(name); return deps[name]; },
  });
  return exports;
}

function harness(replies, connecting) {
  const sent = [];
  const request = (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {};
    req.end = body => {
      const reply = replies[sent.length]; sent.push(JSON.parse(body));
      queueMicrotask(() => {
        if (connecting !== undefined) {
          const socket = new EventEmitter(); socket.connecting = connecting;
          req.emit("socket", socket);
        }
        if (reply instanceof Error) { req.emit("error", reply); return; }
        const response = new EventEmitter(); response.statusCode = reply.status || 200;
        callback(response);
        response.emit("data", Buffer.from(JSON.stringify(reply.body)));
        response.emit("end");
      });
    };
    return req;
  };
  const loaded = load("app/api/_lib/social-publish.ts", {
    "node:https": { request },
    "node:http": { request },
    "./public-fetch": { fetchPublicResource: () => { throw new Error("Unexpected image download"); } },
    "./image-type": {},
    "./publishing-config": load("app/api/_lib/publishing-config.ts"),
    "./telegram-proxy": load("app/api/_lib/telegram-proxy.ts", {}, { process: { env: {} } }),
  });
  return { sent, send: text => loaded.publishToChannel({ platform: "telegram", credentialsJson: JSON.stringify({ platform: "telegram", telegram: { chatId: "test", botToken: "test-only" } }), text, imageUrl: null }) };
}

test("partial Telegram delivery is never automatically replayed", async () => {
  const h = harness([{ body: { ok: true, result: { message_id: 123 } } }, { status: 429, body: { ok: false, description: "Rate limit" } }]);
  await assert.rejects(h.send("word ".repeat(1500)), error => {
    assert.equal(error.retryable, false); assert.equal(error.providerPostId, "123");
    assert.match(error.message, /Telegram принял 1/); return true;
  });
  assert.equal(h.sent.length, 2);
});

test("lost Telegram acknowledgement is treated as unknown, not retried", async () => {
  const h = harness([new Error("socket reset")]);
  await assert.rejects(h.send("text"), error => error.retryable === false);
  assert.equal(h.sent.length, 1);
});

test("Telegram retries only a known unconnected socket, never a reused connection", async () => {
  for (const connecting of [true, false]) {
    const h = harness([new Error("transport failed")], connecting);
    await assert.rejects(h.send("text"), error => error.retryable === connecting);
    assert.equal(h.sent.length, 1);
  }
});

test("explicit rate limit before any delivery remains safely retryable", async () => {
  const h = harness([{ status: 429, body: { ok: false, description: "Rate limit" } }]);
  await assert.rejects(h.send("text"), error => error.retryable === true);
});

test("successful split Telegram delivery retains every part", async () => {
  const h = harness([{ body: { ok: true, result: { message_id: 1 } } }, { body: { ok: true, result: { message_id: 2 } } }]);
  const original = "word ".repeat(1500).trim();
  assert.equal((await h.send(original)).providerPostId, "1");
  assert.equal(h.sent.map(part => part.text).join(" "), original);
});

for (const scenario of ["receipt", "connect", "exhausted", "unknown", "partial"]) test(`publication state survives ${scenario} failure`, async () => {
  const schema = Object.fromEntries(["publications", "generations", "socialChannels"].map(name => [name, { id: "id", ownerEmail: "ownerEmail", status: "status" }]));
  const publication = { id: "post", ownerEmail: "owner", generationId: "material", channelId: "channel", status: "scheduled", retryCount: scenario === "exhausted" ? 2 : 0 };
  let externalCalls = 0;
  let receiptWrites = 0;
  const db = {
    update: () => ({ set: patch => ({ where: predicate => {
      const execute = () => {
        if (!predicate(publication)) return [];
        if (patch.status === "published" && ++receiptWrites === 1) throw new Error("temporary database failure");
        Object.assign(publication, patch); return [{ ...publication }];
      };
      return { returning: async () => execute(), then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject) };
    } }) }),
    select: () => ({ from: table => ({ where: predicate => ({ limit: async () => {
      const row = table === schema.generations ? { id: "material", ownerEmail: "owner", title: "Title", body: "Body" } : { id: "channel", ownerEmail: "owner", platform: "telegram" };
      return predicate(row) ? [row] : [];
    } }) }) }),
  };
  class PublishError extends Error {}
  const loaded = load("app/api/_lib/publish-attempt.ts", {
    "drizzle-orm": { eq: (key, value) => row => row[key] === value, inArray: (key, values) => row => values.includes(row[key]), and: (...predicates) => row => predicates.every(predicate => predicate(row)), sql: () => "now" },
    "../../../db": { getDb: () => db }, "../../../db/schema": schema,
    "./social-publish": { PublishError, publishToChannel: async () => {
      externalCalls++;
      if (scenario !== "receipt") {
        const error = new PublishError("Test transport failure");
        error.retryable = scenario === "connect" || scenario === "exhausted";
        if (scenario === "partial") error.providerPostId = "first-part";
        throw error;
      }
      return { providerPostId: "confirmed" };
    } },
    "./publishing-config": { MAX_PUBLISH_RETRIES: 3 },
    "./email": { emailDeliveryAvailable: () => false },
  });
  assert.equal(await loaded.attemptPublish("post", "another-owner", "https://example.com"), null);
  assert.equal(externalCalls, 0);
  const result = await loaded.attemptPublish("post", "owner", "https://example.com");
  if (scenario !== "receipt") {
    assert.equal(result.status, scenario === "connect" ? "scheduled" : "failed");
    assert.equal(publication.status, result.status);
    assert.equal(publication.generationId, "material");
    assert.equal(publication.channelId, "channel");
    assert.equal(externalCalls, 1);
    if (scenario === "connect") assert.match(result.errorMessage, /Запланирован автоматический повтор/);
    if (scenario === "exhausted") assert.match(result.errorMessage, /Лимит автоматических попыток исчерпан/);
    if (scenario === "partial") assert.equal(publication.providerPostId, "first-part");
    return;
  }
  assert.equal(result.status, "published");
  assert.equal(receiptWrites, 2);
  assert.equal(externalCalls, 1);
  assert.equal(publication.status, "published");
});

test("Telegram channel validation separates transport failures from invalid credentials", async () => {
  // social-channels.ts's getChat now speaks node:https (IPv4-pinned - it
  // hit the exact same Timeweb connect-timeout the publish path already
  // had fixed, just via a call site that had been missed), not fetch - a
  // real HTTP response here is status + raw body bytes, so "invalid-json"
  // is simulated as literally malformed bytes rather than a throwing
  // json() stand-in, closer to what Telegram would actually send.
  for (const kind of ["network", "server", "invalid-json", "unauthorized", "success"]) {
    const request = (_options, callback) => {
      const req = new EventEmitter();
      req.end = () => {
        if (kind === "network") { queueMicrotask(() => req.emit("error", new Error("connect timeout"))); return; }
        const status = kind === "server" ? 503 : kind === "unauthorized" ? 401 : 200;
        const body = kind === "invalid-json" ? "not json" : JSON.stringify(
          kind === "success" ? { ok: true, result: { title: "Test channel" } } : { ok: false, description: "Unauthorized" },
        );
        const res = new EventEmitter(); res.statusCode = status;
        queueMicrotask(() => {
          callback(res);
          res.emit("data", Buffer.from(body));
          res.emit("end");
        });
      };
      return req;
    };
    const loaded = load("app/api/_lib/social-channels.ts", {
      "./publishing-config": {}, "../../../db/schema": {},
      "node:https": { request },
      "node:http": { request },
      "./telegram-proxy": load("app/api/_lib/telegram-proxy.ts", {}, { process: { env: {} } }),
    }, {
      setTimeout: callback => { callback(); return 0; },
    });
    const request2 = loaded.describeChannel({ platform: "telegram", telegram: { botToken: "test-only", chatId: "test" } });
    if (kind === "success") assert.equal((await request2).label, "Test channel");
    else await assert.rejects(request2, error => {
      assert.match(error.message, kind === "unauthorized" ? /Telegram отклонил подключение/ : /не удалось|недоступен/);
      assert.doesNotMatch(error.message, /Проверьте токен бота/);
      return true;
    });
  }
});

test("saving a failed publication cannot silently requeue it", () => {
  const source = readFileSync(new URL("../app/api/publications/route.ts", import.meta.url), "utf8");
  const update = source.split('if (action === "update")')[1].split('if (action === "delete")')[0];
  assert.doesNotMatch(update, /reQueue|retryCount:\s*0/);
});
