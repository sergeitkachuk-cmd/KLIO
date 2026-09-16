import { resolveMx, resolve4, resolve6 } from "node:dns/promises";

// Catches the common real-world typo (site owner: a signup that "выглядел
// правильно" but sat unconfirmed forever) — a misspelled domain like
// gmial.com or yandex.ry that the regex in signup/route.ts happily accepts
// but that can never actually receive the verification email. This can't
// catch a typo'd local part (jhon@ vs john@) — nothing short of actually
// sending mail can — only a domain that plainly can't accept mail at all.
//
// Fails OPEN on anything that isn't a confirmed "no such records" answer
// from every one of MX/A/AAAA: a resolver timeout or outage must never
// block a real signup over an infrastructure hiccup on our end, only a
// domain DNS itself confirms has no mail destination. All three queries
// run in parallel under one shared timeout, not three in sequence, so a
// fully unreachable resolver adds one bounded delay to signup, not three.
const LOOKUP_TIMEOUT_MS = 3_000;

function isNoRecordsError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ENOTFOUND" || code === "ENODATA";
}

function hasRecords(result: PromiseSettledResult<unknown[]>): boolean {
  return result.status === "fulfilled" && result.value.length > 0;
}

async function lookup(domain: string): Promise<boolean> {
  // No MX record isn't necessarily fatal — RFC 5321 §5.1 falls back to
  // the domain's own A/AAAA record as a mail destination when no MX
  // exists, and real mail servers honor that, so this checks all three.
  const [mx, a4, a6] = await Promise.allSettled([resolveMx(domain), resolve4(domain), resolve6(domain)]);
  if (hasRecords(mx) || hasRecords(a4) || hasRecords(a6)) return true;
  const allConfirmedEmpty = [mx, a4, a6].every((result) => result.status === "fulfilled" || isNoRecordsError(result.reason));
  return !allConfirmedEmpty;
}

export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const result = await Promise.race([
    lookup(domain),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), LOOKUP_TIMEOUT_MS)),
  ]);
  return result === "timeout" ? true : result;
}
