import test from "node:test";
import assert from "node:assert/strict";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";

test("reconcile and webhook confirm once, consume the discount and preserve later usage", async t => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const paymentId = "test-confirmation-payment";
  await h.db.update(h.schema.accounts).set({ planId: "trial", planExpiresAt: null }).where(orm.eq(h.schema.accounts.email, h.owner));
  await h.db.insert(h.schema.payments).values({ id: paymentId, ownerEmail: h.owner, planId: "start", billing: "monthly", mode: "card", amountKopecks: 79200, discountApplied: true, operationId: "operation-test" });
  const body = load("app/api/_lib/request-body.ts");
  class WorkspaceAccessError extends Error {}
  const dependencies = {
    "drizzle-orm": orm,
    "../../../../../db/schema": h.schema,
    "../../../_lib/workspace-account": { getWorkspaceDb: async () => h.db, workspaceIdentity: async () => ({ email: h.owner }), WorkspaceAccessError },
    "../../../_lib/tochka": { TochkaConfigError: class extends Error {}, tochkaRequest: async () => ({ Data: { status: "APPROVED" } }), verifyTochkaWebhook: async () => ({ webhookType: "acquiringInternetPayment", status: "APPROVED", paymentLinkId: paymentId, operationId: "operation-test", amount: 792 }) },
    "../../../_lib/subscription": load("app/api/_lib/subscription.ts"),
    "../../../_lib/request-body": body,
  };
  const reconcile = load("app/api/payments/tochka/reconcile/route.ts", dependencies);
  const webhook = load("app/api/payments/tochka/webhook/route.ts", dependencies);
  const request = () => new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ paymentLinkId: paymentId }) });
  const results = await Promise.all([reconcile.POST(request()), webhook.POST(new Request("https://example.invalid", { method: "POST", body: "fixture-signed-claims" }))]);
  assert.ok(results.every(r => r.status === 200));
  const [account] = await h.db.select().from(h.schema.accounts).where(orm.eq(h.schema.accounts.email, h.owner));
  assert.equal(account.planId, "start");
  assert.ok(account.launchDiscountUsedAt);
  assert.ok(new Date(account.planExpiresAt).getTime() - Date.now() < 32 * 86400000);
  await h.db.update(h.schema.accounts).set({ generationsUsed: 3 }).where(orm.eq(h.schema.accounts.email, h.owner));
  assert.equal((await reconcile.POST(request())).status, 200);
  const [after] = await h.db.select().from(h.schema.accounts).where(orm.eq(h.schema.accounts.email, h.owner));
  assert.equal(after.generationsUsed, 3);
  assert.equal(after.planExpiresAt, account.planExpiresAt);
  await h.db.update(h.schema.payments).set({ status: "pending" }).where(orm.eq(h.schema.payments.id, paymentId));
  const raced = load("app/api/payments/tochka/reconcile/route.ts", { ...dependencies, "../../../_lib/tochka": { ...dependencies["../../../_lib/tochka"], tochkaRequest: async () => {
    await h.db.update(h.schema.payments).set({ status: "refunded" }).where(orm.eq(h.schema.payments.id, paymentId));
    return { Data: { status: "APPROVED" } };
  } } });
  assert.equal((await (await raced.POST(request())).json()).status, "refunded");
});

test("a refund restores the active plan that existed before the purchase", async t => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const paymentId = "restore-previous-plan-payment";
  const previousExpiry = new Date(Date.now() + 18 * 86400000).toISOString();
  const previousQuotaReset = new Date(Date.now() + 12 * 86400000).toISOString();
  await h.db.update(h.schema.accounts).set({
    planId: "pro",
    planExpiresAt: previousExpiry,
    quotaPeriodEndsAt: previousQuotaReset,
    generationMonth: "2026-09",
    generationsUsed: 4,
    researchUsed: 2,
    editorActionsUsed: 7,
    dialogueActionsUsed: 3,
  }).where(orm.eq(h.schema.accounts.email, h.owner));
  await h.db.insert(h.schema.payments).values({ id: paymentId, ownerEmail: h.owner, planId: "start", billing: "monthly", mode: "card", amountKopecks: 119000, operationId: "restore-operation" });
  let providerStatus = "APPROVED";
  const route = load("app/api/payments/tochka/reconcile/route.ts", {
    "drizzle-orm": orm,
    "../../../../../db/schema": h.schema,
    "../../../_lib/workspace-account": { getWorkspaceDb: async () => h.db, workspaceIdentity: async () => ({ email: h.owner }), WorkspaceAccessError: class extends Error {} },
    "../../../_lib/tochka": { TochkaConfigError: class extends Error {}, tochkaRequest: async () => ({ status: providerStatus }) },
    "../../../_lib/subscription": load("app/api/_lib/subscription.ts"),
    "../../../_lib/request-body": load("app/api/_lib/request-body.ts"),
  });
  const request = () => new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ paymentLinkId: paymentId }) });
  assert.equal((await (await route.POST(request())).json()).status, "paid");
  const [paid] = await h.db.select().from(h.schema.accounts).where(orm.eq(h.schema.accounts.email, h.owner));
  assert.equal(paid.planId, "start");
  const [snapshot] = await h.db.select().from(h.schema.payments).where(orm.eq(h.schema.payments.id, paymentId));
  assert.equal(snapshot.previousPlanId, "pro");
  providerStatus = "REFUNDED";
  assert.equal((await (await route.POST(request())).json()).status, "refunded");
  const [restored] = await h.db.select().from(h.schema.accounts).where(orm.eq(h.schema.accounts.email, h.owner));
  assert.equal(restored.planId, "pro");
  assert.equal(restored.planExpiresAt, previousExpiry);
  assert.equal(restored.quotaPeriodEndsAt, previousQuotaReset);
  assert.equal(restored.generationsUsed, 4);
  assert.equal(restored.researchUsed, 2);
  assert.equal(restored.editorActionsUsed, 7);
  assert.equal(restored.dialogueActionsUsed, 3);
});

test("payment confirmation waits for bank completion and cancels on navigation", async () => {
  const { waitForPaymentConfirmation } = load("app/payment-confirmation.ts");
  let calls = 0;
  const controller = new AbortController();
  assert.equal(await waitForPaymentConfirmation("payment-test", { signal: controller.signal, delay: async () => {}, fetcher: async () => Response.json({ status: ++calls < 3 ? "pending" : "paid" }) }), "paid");
  assert.equal(calls, 3);
  controller.abort();
  await assert.rejects(waitForPaymentConfirmation("payment-test", { signal: controller.signal, fetcher: async () => { throw Error("must not fetch"); } }));
});

test("payment diagnostic retains API errors but removes credentials and addresses", () => {
  const secret = "test-private-bank-token";
  const { paymentErrorDetail } = load("app/api/_lib/payment-diagnostics.ts", {}, { Error, process: { env: { TOCHKA_JWT_TOKEN: secret } } });
  const detail = paymentErrorDetail(new Error(`Tochka API 403 ${secret} https://host.invalid/?token=private person@example.invalid`));
  assert.match(detail, /Tochka API 403/);
  for (const forbidden of [secret, "person@example.invalid", "token=private"]) assert.ok(!detail.includes(forbidden));
  assert.equal(paymentErrorDetail(new Error("Failed query", { cause: new Error('column "discount_applied" does not exist') })), 'column "discount_applied" does not exist');
});

test("monthly discount and quarterly checkout send consistent bank and receipt amounts, with useful administrator errors", async t => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const operations = [];
  let bankFailure = false;
  const route = load("app/api/payments/tochka/create/route.ts", {
    "drizzle-orm": orm,
    "../../../../../db/schema": h.schema,
    "../../../_lib/workspace-account": { getWorkspaceDb: async () => h.db, workspaceIdentity: async () => ({ email: h.owner }), ensureAccount: async () => ({ launchDiscountUsedAt: null }), WorkspaceAccessError: class extends Error {} },
    "../../../_lib/request-body": load("app/api/_lib/request-body.ts"),
    "../../../_lib/admin": { isAdminEmail: () => true },
    "../../../_lib/payment-diagnostics": load("app/api/_lib/payment-diagnostics.ts", {}, { Error }),
    "../../../_lib/base-url": { resolveBaseUrl: () => "https://цифроваяредакция.рф" },
    "../../../../plans": load("app/plans.ts"),
    "../../../../billing-pricing": { ...load("app/billing-pricing.ts"), launchDiscountWindowOpen: () => true },
    "../../../../payment-link": load("app/payment-link.ts"),
    "../../../_lib/tochka": {
      TochkaConfigError: class extends Error {}, discoverTochkaIds: async () => ({ customerCode: "test", merchantId: "test" }),
      extractPaymentUrl: () => "https://example.invalid/pay", extractOperationId: () => "test-operation",
      tochkaRequest: async (_path, options) => { operations.push(JSON.parse(options.body).Data); if (bankFailure) throw new Error("Tochka API 403: Access denied"); return {}; },
    },
  });
  const request = billing => new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ planId: "start", billing, mode: "card" }) });
  for (const [billing, amount] of [["monthly", 792], ["quarterly", 2822]]) {
    const response = await route.POST(request(billing));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).amount, amount);
    const operation = operations.at(-1);
    assert.equal(operation.amount, amount);
    assert.equal(operation.Items[0].amount, amount);
    assert.ok(operation.redirectUrl.startsWith("https://xn--"));
  }
  bankFailure = true;
  const failed = await route.POST(request("monthly"));
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /bank-create-link: Tochka API 403/);
});
