import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";

test("support acknowledges a new conversation once, while every follow-up still reaches the operator", async t => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let email = h.owner;
  const notifications = [];
  class WorkspaceAccessError extends Error {}
  const route = load("app/api/feedback/route.ts", {
    "node:crypto": { randomUUID },
    "drizzle-orm": orm,
    "../../../db/schema": h.schema,
    "../_lib/request-body": load("app/api/_lib/request-body.ts"),
    "../_lib/workspace-account": {
      workspaceIdentity: async () => ({ email }),
      getWorkspaceDb: async () => h.db,
      ensureAccount: async () => {},
      WorkspaceAccessError,
    },
    "../_lib/email": { emailDeliveryAvailable: () => false },
    "../_lib/admin-notify": {
      adminTelegramAvailable: () => true,
      sendAdminTelegramMessage: async text => { notifications.push(text); return { messageId: notifications.length }; },
    },
  });
  const post = async message => {
    const response = await route.POST(new Request("https://klio.example/api/feedback", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
    }));
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = await post("Something is not working");
  assert.equal(first.botMessage.sender, "bot");
  assert.equal((await post("Here are more details")).botMessage, null);
  await h.db.insert(h.schema.feedbackMessages).values({ id: randomUUID(), ownerEmail: email, sender: "admin", body: "I am looking into this" });
  assert.equal((await post("Thank you, one more detail")).botMessage, null);
  const own = await h.db.select().from(h.schema.feedbackMessages).where(orm.eq(h.schema.feedbackMessages.ownerEmail, email));
  assert.equal(own.filter(row => row.sender === "bot").length, 1);
  assert.equal(own.filter(row => row.sender === "client").length, 3);
  assert.deepEqual(own.filter(row => row.sender === "client").map(row => row.telegramMessageId).sort(), ["1", "2", "3"]);
  assert.equal(notifications.length, 3);

  // Two tabs sending their first message together must not create two acks.
  email = "parallel@example.invalid";
  await h.db.insert(h.schema.accounts).values({ email, generationMonth: "2026-11" });
  const parallel = await Promise.all([post("First part"), post("Second part")]);
  assert.equal(parallel.filter(result => result.botMessage).length, 1);
  assert.equal(notifications.length, 5);
});
