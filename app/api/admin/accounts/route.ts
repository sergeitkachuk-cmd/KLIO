import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { accounts } from "../../../../db/schema";
import { isPlanId, type PlanId } from "../../../plans";

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
  const nextExpiry = planId === "trial" || months === 0
    ? null
    : months === null
      ? current.planExpiresAt
      : addMonths(current.planExpiresAt && new Date(current.planExpiresAt).getTime() > Date.now() ? new Date(current.planExpiresAt) : new Date(), months).toISOString();
  const [updated] = await db.update(accounts).set({ planId: planId as PlanId, planExpiresAt: nextExpiry, updatedAt: new Date().toISOString() }).where(eq(accounts.email, email)).returning({ email: accounts.email, planId: accounts.planId, planExpiresAt: accounts.planExpiresAt });
  return NextResponse.json(updated);
}
