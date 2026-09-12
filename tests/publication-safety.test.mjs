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

function harness(replies) {
  const sent = [];
  const request = (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {};
    req.end = body => {
      const reply = replies[sent.length]; sent.push(JSON.parse(body));
      queueMicrotask(() => {
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
    "./public-fetch": { fetchPublicResource: () => { throw new Error("Unexpected image download"); } },
    "./image-type": {},
    "./publishing-config": load("app/api/_lib/publishing-config.ts"),
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

test("receipt write failure retries the database, never the external publication", async () => {
  const schema = Object.fromEntries(["publications", "generations", "socialChannels"].map(name => [name, { id: "id", ownerEmail: "ownerEmail", status: "status" }]));
  const publication = { id: "post", ownerEmail: "owner", generationId: "material", channelId: "channel", status: "scheduled", retryCount: 0 };
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
    "./social-publish": { PublishError, publishToChannel: async () => { externalCalls++; return { providerPostId: "confirmed" }; } },
    "./publishing-config": { MAX_PUBLISH_RETRIES: 3 },
    "./email": { emailDeliveryAvailable: () => false },
  });
  assert.equal(await loaded.attemptPublish("post", "another-owner", "https://example.com"), null);
  assert.equal(externalCalls, 0);
  assert.equal((await loaded.attemptPublish("post", "owner", "https://example.com")).status, "published");
  assert.equal(receiptWrites, 2);
  assert.equal(externalCalls, 1);
  assert.equal(publication.status, "published");
});
