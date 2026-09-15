import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { accounts, aiUsage, asyncJobs, brands, emailVerifications, generations, invoices, materials, passwordResets, payments, sessions } from "../../../../db/schema";
import { isPlanId, type PlanId } from "../../../plans";
import { nextQuotaPeriodEnd } from "../../_lib/subscription";

function addMonths(base: Date, months: number) {
  const result = new Date(base);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "Недоступно" }, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown; planId?: unknown; months?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const planId = body?.planId;
  const months = body?.months === undefined || body?.months === null || body?.months === "" ? null : Number(body.months);
  if (!email || !isPlanId(planId) || (months !== null && (!Number.isInteger(months) || months < 0 || months > 120))) {
    return NextResponse.json({ error: "Проверьте email, тариф и количество месяцев" }, { status: 400 });
  }
  const db = getDb();
  const [current] = await db.select({ planExpiresAt: accounts.planExpiresAt }).from(accounts).where(eq(accounts.email, email)).limit(1);
  if (!current) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  const now = new Date();
  const isTrialOrClear = planId === "trial" || months === 0;
  const nextExpiry = isTrialOrClear
    ? null
    : months === null
      ? current.planExpiresAt
      : addMonths(current.planExpiresAt && new Date(current.planExpiresAt).getTime() > now.getTime() ? new Date(current.planExpiresAt) : now, months).toISOString();
  const [updated] = await db.update(accounts).set({
    planId: planId as PlanId,
    planExpiresAt: nextExpiry,
    // Assigning a plan here should behave like a fresh grant, not silently
    // carry over whatever was used under whatever plan the account had
    // before — a real payment already resets these same three counters
    // (see the confirmedPayment branch in tochka/webhook's route.ts). This
    // admin override was the one path that changed planId without also
    // doing that, which is exactly how a brand-new "Старт" account could
    // show "5 из 5 исследований" already spent before ever really using
    // the new plan (site owner: hit this after granting a plan by hand).
    generationsUsed: 0,
    researchUsed: 0,
    editorActionsUsed: 0,
    generationMonth: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    quotaPeriodEndsAt: isTrialOrClear ? null : nextQuotaPeriodEnd(now),
    updatedAt: now.toISOString(),
  }).where(eq(accounts.email, email)).returning({ email: accounts.email, planId: accounts.planId, planExpiresAt: accounts.planExpiresAt });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "Недоступно" }, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "Укажите email" }, { status: 400 });
  if (email === user.email.toLowerCase()) return NextResponse.json({ error: "Нельзя удалить собственный аккаунт администратора" }, { status: 400 });
  if (isAdminEmail(email)) return NextResponse.json({ error: "Аккаунт администратора защищён" }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select({ email: accounts.email }).from(accounts).where(eq(accounts.email, email)).limit(1);
  if (!existing) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  // There are no foreign keys in the legacy schema, so remove dependent rows
  // explicitly before deleting the account itself.
  await db.delete(payments).where(eq(payments.ownerEmail, email));
  await db.delete(invoices).where(eq(invoices.ownerEmail, email));
  await db.delete(sessions).where(eq(sessions.email, email));
  await db.delete(emailVerifications).where(eq(emailVerifications.email, email));
  await db.delete(passwordResets).where(eq(passwordResets.email, email));
  await db.delete(brands).where(eq(brands.ownerEmail, email));
  await db.delete(generations).where(eq(generations.ownerEmail, email));
  await db.delete(materials).where(eq(materials.ownerEmail, email));
  await db.delete(aiUsage).where(eq(aiUsage.ownerEmail, email));
  await db.delete(asyncJobs).where(eq(asyncJobs.ownerEmail, email));
  await db.delete(accounts).where(eq(accounts.email, email));
  return NextResponse.json({ ok: true, email });
}
