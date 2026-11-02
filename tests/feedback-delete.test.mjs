import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";

test("only an authenticated administrator can delete an operator reply in the specified conversation", async t => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let user = { email: "admin@example.invalid" };
  const body = load("app/api/_lib/request-body.ts");
  const origin = load("app/api/_lib/request-origin.ts", { "./base-url": { resolveBaseUrl: () => "https://klio.example" } });
  const route = load("app/api/admin/feedback/route.ts", {
    "../../../identity": { getCurrentUser: async () => user },
    "../../_lib/admin": { isAdminEmail: email => email === "admin@example.invalid" },
    "../../_lib/feedback-reply": {},
    "drizzle-orm": orm,
    "../../../../db": { getDb: () => h.db },
    "../../../../db/schema": h.schema,
    "../../_lib/request-body": body,
    "../../_lib/request-origin": origin,
  });
  const replyId = randomUUID(), clientId = randomUUID(), botId = randomUUID(), otherId = randomUUID();
  await h.db.insert(h.schema.feedbackMessages).values([
    { id: replyId, ownerEmail: h.owner, sender: "admin", body: "Duplicate reply" },
    { id: clientId, ownerEmail: h.owner, sender: "client", body: "Question" },
    { id: botId, ownerEmail: h.owner, sender: "bot", body: "Acknowledgement" },
    { id: otherId, ownerEmail: "other@example.invalid", sender: "admin", body: "Other conversation" },
  ]);
  const remove = (id = replyId, ownerEmail = h.owner, headers = {}) => route.DELETE(new Request("https://klio.example/api/admin/feedback", {
    method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ id, ownerEmail }),
  }));
  user = null; assert.equal((await remove()).status, 403);
  assert.equal((await route.GET()).status, 403);
  user = { email: h.owner }; assert.equal((await remove()).status, 403);
  assert.equal((await route.GET()).status, 403);
  user = { email: "admin@example.invalid" };
  const history = await route.GET();
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("cache-control"), "private, no-store");
  assert.equal((await history.json()).messages.length, 4);
  assert.equal((await remove(replyId, h.owner, { origin: "https://attacker.example" })).status, 403);
  assert.equal((await remove("")).status, 400);
  assert.equal((await remove(clientId)).status, 404);
  assert.equal((await remove(botId)).status, 404);
  assert.equal((await remove(otherId)).status, 404);
  assert.equal((await h.db.select().from(h.schema.feedbackMessages)).length, 4);
  const deleted = await remove(); assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deletedId, replyId);
  const remaining = await h.db.select().from(h.schema.feedbackMessages);
  assert.deepEqual(remaining.map(row => row.id).sort(), [clientId, botId, otherId].sort());
  assert.equal((await remove()).status, 404);
});
