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
  const paths = [];
  const request = (options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {};
    req.end = body => {
      paths.push(options.path);
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
  return {
    sent, paths,
    send: (text, imageUrls = []) => loaded.publishToChannel({ platform: "telegram", credentialsJson: JSON.stringify({ platform: "telegram", telegram: { chatId: "test", botToken: "test-only" } }), text, imageUrls }),
  };
}

// One VK image upload is always the same 3-call shape (getWallUploadServer,
// the raw byte upload, saveWallPhoto) regardless of how many images end up
// in the post - see uploadPhotoForWall's own comment in social-publish.ts.
function vkImageUploadReplies(photoId, ownerId) {
  return [
    { body: { response: { upload_url: "https://upload.vk.example/put" } } },
    { body: { server: 1, photo: "blob-token", hash: "hash-token" } },
    { body: { response: [{ id: photoId, owner_id: ownerId }] } },
  ];
}

// VK has no self-hosted-relay equivalent to Telegram's - every call
// (prep steps and wall.post alike) goes through global fetch directly, so
// this mocks that instead of node:http(s). fetchPublicResource/image-type
// are mocked too (not the real image-type module) since exercising real
// magic-byte sniffing adds nothing here - only that a Blob gets built at
// all, matching this file's existing minimal-mock style for the Telegram
// harness above.
function vkHarness(fetchReplies) {
  const calls = [];
  const fetchMock = async (url, options) => {
    const reply = fetchReplies[calls.length];
    calls.push({ url: String(url), body: options?.body });
    if (reply instanceof Error) throw reply;
    return { ok: reply.status ? reply.status < 400 : true, status: reply.status || 200, json: async () => reply.body };
  };
  const loaded = load("app/api/_lib/social-publish.ts", {
    "node:https": {},
    "node:http": {},
    "./public-fetch": { fetchPublicResource: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]) }) },
    "./image-type": { imageContentType: () => "image/jpeg" },
    "./publishing-config": load("app/api/_lib/publishing-config.ts"),
    "./telegram-proxy": load("app/api/_lib/telegram-proxy.ts", {}, { process: { env: {} } }),
    // fetchImageBytes/uploadPhotoForWall build a real Blob and post it
    // through a real FormData - neither is in load()'s base global list
    // (only needed for this VK path, not Telegram), so without these the
    // module throws a generic ReferenceError that fetchImageBytes' own
    // catch-all then reports as a believable-looking but wrong "couldn't
    // download the image" PublishError instead.
  }, { fetch: fetchMock, Blob, FormData });
  return {
    calls,
    send: imageUrls => loaded.publishToChannel({
      platform: "vk",
      credentialsJson: JSON.stringify({ platform: "vk", vk: { groupId: "55", accessToken: "wall-token", photoAccessToken: "photo-token" } }),
      text: "hello",
      imageUrls,
    }),
  };
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

test("Telegram sends exactly one image via sendPhoto, unchanged from before multi-image support", async () => {
  const h = harness([{ body: { ok: true, result: { message_id: 55 } } }]);
  const result = await h.send("caption text", ["https://cdn.example.invalid/a.png"]);
  assert.equal(h.sent.length, 1);
  assert.ok(h.paths[0].endsWith("/sendPhoto"));
  assert.equal(h.sent[0].photo, "https://cdn.example.invalid/a.png");
  assert.equal(h.sent[0].caption, "caption text");
  assert.equal(result.providerPostId, "55");
});

test("Telegram sends 2+ images as one sendMediaGroup call, caption only on the first item", async () => {
  const h = harness([{ body: { ok: true, result: [{ message_id: 10 }, { message_id: 11 }, { message_id: 12 }] } }]);
  const result = await h.send("caption text", ["https://cdn.example.invalid/a.png", "https://cdn.example.invalid/b.png", "https://cdn.example.invalid/c.png"]);
  assert.equal(h.sent.length, 1);
  assert.ok(h.paths[0].endsWith("/sendMediaGroup"));
  assert.deepEqual(h.sent[0].media, [
    { type: "photo", media: "https://cdn.example.invalid/a.png", caption: "caption text" },
    { type: "photo", media: "https://cdn.example.invalid/b.png" },
    { type: "photo", media: "https://cdn.example.invalid/c.png" },
  ]);
  assert.equal(result.providerPostId, "10");
  assert.match(result.providerPostId, /^\d+$/);
});

test("partial delivery after a media group is never automatically replayed", async () => {
  const h = harness([
    { body: { ok: true, result: [{ message_id: 20 }, { message_id: 21 }] } },
    { status: 429, body: { ok: false, description: "Rate limit" } },
  ]);
  await assert.rejects(h.send("word ".repeat(1500), ["https://cdn.example.invalid/a.png", "https://cdn.example.invalid/b.png"]), error => {
    assert.equal(error.retryable, false);
    assert.equal(error.providerPostId, "20");
    assert.match(error.message, /Telegram принял 1/);
    return true;
  });
  assert.equal(h.sent.length, 2);
});

test("VK publishes a single image exactly as before multi-image support", async () => {
  const h = vkHarness([...vkImageUploadReplies(10, -55), { body: { response: { post_id: 900 } } }]);
  const result = await h.send(["https://cdn.example.invalid/a.png"]);
  assert.equal(h.calls.length, 4);
  assert.equal(result.providerPostId, "900");
});

test("VK uploads every image then joins them into one wall.post with comma-separated attachments", async () => {
  const h = vkHarness([
    ...vkImageUploadReplies(1, -55),
    ...vkImageUploadReplies(2, -55),
    ...vkImageUploadReplies(3, -55),
    { body: { response: { post_id: 901 } } },
  ]);
  const result = await h.send(["https://cdn.example.invalid/a.png", "https://cdn.example.invalid/b.png", "https://cdn.example.invalid/c.png"]);
  assert.equal(h.calls.length, 10);
  const wallPostCall = h.calls[9];
  assert.equal(wallPostCall.url, "https://api.vk.com/method/wall.post");
  assert.equal(wallPostCall.body.get("attachments"), "photo-55_1,photo-55_2,photo-55_3");
  assert.equal(result.providerPostId, "901");
});

test("a failed upload partway through a VK carousel aborts before wall.post is ever called", async () => {
  const h = vkHarness([
    ...vkImageUploadReplies(1, -55),
    { body: { response: { upload_url: "https://upload.vk.example/put" } } },
    new Error("network down"),
  ]);
  await assert.rejects(h.send(["https://cdn.example.invalid/a.png", "https://cdn.example.invalid/b.png", "https://cdn.example.invalid/c.png"]), error => {
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(h.calls.length, 5);
});

function loadPublishAttempt() {
  const { resolveImageUrls } = load("app/api/_lib/publish-attempt.ts", {
    "drizzle-orm": { eq: () => () => true, inArray: () => () => true, and: () => () => true, sql: () => "now" },
    "../../../db": { getDb: () => ({}) },
    "../../../db/schema": {},
    "./social-publish": { PublishError: class extends Error {}, publishToChannel: async () => ({ providerPostId: "unused" }) },
    "./publishing-config": { MAX_PUBLISH_RETRIES: 3 },
    "./email": { emailDeliveryAvailable: () => false, sendPublicationFailedEmail: async () => {} },
  });
  // resolveImageUrls runs inside the vm sandbox, so any array it builds
  // internally is a different-realm Array from this file's own - same
  // structure, but deepStrictEqual (what assert/strict's deepEqual is
  // aliased to) also checks prototype identity and fails on that alone.
  // Spreading here copies it into a plain, same-realm array before any
  // assertion below compares it against a literal.
  return (generation, telegramDeliveryMode) => [...resolveImageUrls(generation, telegramDeliveryMode)];
}

test("resolveImageUrls expands an untouched carousel to every slide, in order", () => {
  const resolveImageUrls = loadPublishAttempt();
  const slides = [{ headline: "a", subtext: "a", imageUrl: "u1" }, { headline: "b", subtext: "b", imageUrl: "u2" }, { headline: "c", subtext: "c", imageUrl: "u3" }];
  assert.deepEqual(resolveImageUrls({ imageUrl: "u1", slidesJson: JSON.stringify(slides) }, "photo_continue"), ["u1", "u2", "u3"]);
});

test("resolveImageUrls respects a replaced or detached image instead of expanding", () => {
  const resolveImageUrls = loadPublishAttempt();
  const slides = [{ imageUrl: "u1" }, { imageUrl: "u2" }];
  assert.deepEqual(resolveImageUrls({ imageUrl: "custom", slidesJson: JSON.stringify(slides) }, "photo_continue"), ["custom"]);
  assert.deepEqual(resolveImageUrls({ imageUrl: "", slidesJson: JSON.stringify(slides) }, "photo_continue"), []);
});

test("resolveImageUrls sends nothing in text_only mode, even for an untouched carousel", () => {
  const resolveImageUrls = loadPublishAttempt();
  const slides = [{ imageUrl: "u1" }, { imageUrl: "u2" }];
  assert.deepEqual(resolveImageUrls({ imageUrl: "u1", slidesJson: JSON.stringify(slides) }, "text_only"), []);
});

test("resolveImageUrls falls back to the single image on empty or corrupted slidesJson", () => {
  const resolveImageUrls = loadPublishAttempt();
  assert.deepEqual(resolveImageUrls({ imageUrl: "u1", slidesJson: "" }, "photo_continue"), ["u1"]);
  assert.deepEqual(resolveImageUrls({ imageUrl: "u1", slidesJson: "not json" }, "photo_continue"), ["u1"]);
  assert.deepEqual(resolveImageUrls({ imageUrl: "u1", slidesJson: '{"not":"an array"}' }, "photo_continue"), ["u1"]);
});

test("resolveImageUrls caps an untouched carousel at 10 slides", () => {
  const resolveImageUrls = loadPublishAttempt();
  const slides = Array.from({ length: 12 }, (_, index) => ({ imageUrl: `u${index}` }));
  assert.deepEqual(resolveImageUrls({ imageUrl: "u0", slidesJson: JSON.stringify(slides) }, "photo_continue"), slides.slice(0, 10).map(slide => slide.imageUrl));
});

test("editing an already-published carousel keeps its slidesJson in the forked row", () => {
  const source = readFileSync(new URL("../app/api/publications/route.ts", import.meta.url), "utf8");
  const forkBlock = source.split("shouldForkPublished && currentGeneration) {")[1].split("const [forkedPublication]")[0];
  assert.match(forkBlock, /slidesJson:\s*currentGeneration\.slidesJson/);
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
