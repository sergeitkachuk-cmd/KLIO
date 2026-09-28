import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { parseDatabaseConnection } from "../db/connection.mjs";
import { getDatabaseSchemaName } from "../db/namespace.mjs";

const connectionErrorCodes = [
  "ERR_INVALID_URL", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN",
  "ETIMEDOUT", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED",
  "28P01", "28000", "42501", "3D000", "42P01", "42703", "53300", "57P03",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CONNECTION_PREFLIGHT_TIMEOUT",
];

/** Driver errors can contain SQL and passwords: only allowlisted codes leave here. */
export function databaseErrorCode(error) {
  const pending = [error];
  const seen = new Set();
  while (pending.length && seen.size < 20) {
    const item = pending.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (connectionErrorCodes.includes(item.code)) return item.code;
    pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 20));
  }
  return "DATABASE_CONNECTION_FAILED";
}

/** Drizzle's progress UI discards connection errors. Check them without its CLI. */
export async function checkDatabaseConnection({ env = process.env, connect = postgres, timeoutMs = 15_000 } = {}) {
  const credentials = parseDatabaseConnection(env.DATABASE_URL || "postgresql://localhost/klio");
  const client = connect({
    ...credentials,
    ssl: env.DATABASE_URL ? "require" : false,
    max: 1,
    connect_timeout: 10,
    connection: { statement_timeout: 10_000 },
    onnotice: () => {},
  });
  let timer;
  try {
    // Read-only: no schema or customer data is changed by this check.
    await Promise.race([
      client.unsafe("SELECT 1 AS klio_connection_check"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Database connection check timed out."), {
          code: "CONNECTION_PREFLIGHT_TIMEOUT",
        })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await client.end({ timeout: 1 }).catch(() => {});
  }
}

/** Drizzle 0.31 can print an error and still exit 0. Require explicit success. */
export function preparationSucceeded(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return result.status === 0 && !result.error && !result.signal
    && /Changes applied|No changes detected/.test(output)
    && !/\b(?:Error|ERROR|Fatal|FATAL|Exception)\b/.test(output);
}

/** Only fixed diagnostics are logged: driver errors may include credentials. */
export function preparationFailureCode(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  for (const code of connectionErrorCodes) {
    if (output.includes(code) || result.error?.code === code) return code;
  }
  if (result.error || result.signal) return "PROCESS_FAILED";
  if (result.status !== 0) return "DRIZZLE_PROCESS_FAILED";
  return "NO_SUCCESS_CONFIRMATION";
}

// One-time, idempotent: converts the old "one row holds both the client's
// message and the admin's reply" feedback_messages shape into one row per
// individual message (see the table's own comment in db/schema.ts for why -
// short version: a whole conversation needs to render as an ordered
// timeline, not a pile of disconnected Q&A cards).
//
// The drizzle-kit push just before this call already added sender/body as
// NOT NULL DEFAULT 'client'/'', which Postgres itself backfills onto every
// pre-existing row - so "sender = 'client'" can't be used to tell a
// genuinely new row from an old one that hasn't been split yet, they're
// identical after that backfill. What's still distinguishing at that point
// is body itself: an old row's body is still exactly '' (nothing has ever
// written to it), while message (the pre-migration column, populated for
// every real historical row) holds its real text - "body = '' AND message
// IS NOT NULL" is what "still needs migrating" means below. Once step 1
// copies message into body, that row stops matching its own WHERE clause -
// naturally idempotent on the next boot, no separate "already ran" flag
// needed. Same idea for step 2/3's reply -> its own row, then reply
// cleared so it can't be inserted a second time.
//
// UUIDs are generated here in JS (node:crypto, same randomUUID() every
// other insert in this codebase already uses) rather than relying on
// Postgres's own gen_random_uuid() - keeps this independent of which
// Postgres version/extensions the host happens to have.
export async function migrateFeedbackThreads({ env = process.env, connect = postgres, log = console.log } = {}) {
  const credentials = parseDatabaseConnection(env.DATABASE_URL || "postgresql://localhost/klio");
  // Without this, an unqualified "feedback_messages" below resolves through
  // Postgres's own default search_path (public) regardless of which schema
  // this deploy is actually meant to touch - a KLIO_PREVIEW_SCHEMA preview
  // build shares its database with production (see db/namespace.mjs), so a
  // preview container's boot would otherwise run this migration against
  // production's real table instead of its own isolated one.
  const sql = connect({
    ...credentials,
    ssl: env.DATABASE_URL ? "require" : false,
    max: 1,
    connect_timeout: 10,
    connection: { statement_timeout: 30_000, search_path: getDatabaseSchemaName(env) },
    onnotice: () => {},
  });
  try {
    await sql.begin(async (tx) => {
      const clientRows = await tx`
        UPDATE feedback_messages SET sender = 'client', body = message
        WHERE body = '' AND message IS NOT NULL
        RETURNING id
      `;
      const pendingReplies = await tx`
        SELECT owner_email, reply, COALESCE(replied_at, created_at) AS reply_at
        FROM feedback_messages
        WHERE message IS NOT NULL AND reply IS NOT NULL
      `;
      if (pendingReplies.length) {
        const adminRows = pendingReplies.map((row) => ({
          id: randomUUID(),
          owner_email: row.owner_email,
          sender: "admin",
          body: row.reply,
          created_at: row.reply_at,
        }));
        await tx`INSERT INTO feedback_messages ${tx(adminRows, "id", "owner_email", "sender", "body", "created_at")}`;
        await tx`
          UPDATE feedback_messages SET reply = NULL
          WHERE message IS NOT NULL AND reply IS NOT NULL
        `;
      }
      if (clientRows.length || pendingReplies.length) {
        log(`[database] Feedback threads migrated: ${clientRows.length} client row(s) split off, ${pendingReplies.length} reply row(s) promoted to their own message.`);
      }
    });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function prepareDatabase({ env = process.env, cwd = process.cwd(), run = spawnSync, check = checkDatabaseConnection, migrate = migrateFeedbackThreads, log = console.log } = {}) {
  if (!env.DATABASE_URL?.trim() && env.NODE_ENV === "production") {
    log("[database] DATABASE_URL is missing. Application start cancelled.");
    return false;
  }
  try {
    parseDatabaseConnection(env.DATABASE_URL || "postgresql://localhost/klio");
  } catch {
    log("[database] Invalid DATABASE_URL format. Application start cancelled.");
    return false;
  }
  log("[database] Checking database connection...");
  try {
    await check({ env });
  } catch (error) {
    log(`[database] Connection failed: ${databaseErrorCode(error)}. Application start cancelled.`);
    return false;
  }
  log("[database] Database connection confirmed.");
  log("[database] Preparing database tables...");
  const result = run(process.execPath, [resolve(cwd, "node_modules/drizzle-kit/bin.cjs"), "push", "--force"], {
    cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (!preparationSucceeded(result)) {
    log(`[database] Preparation failed: ${preparationFailureCode(result)}. Application start cancelled.`);
    return false;
  }
  log("[database] Database preparation completed.");
  try {
    await migrate({ env, log });
  } catch (error) {
    // Blocks startup rather than limping along on real customer
    // conversation data half-migrated - same "fail loud" call as a
    // drizzle-kit push failure above, not a best-effort background thing.
    log(`[database] Feedback thread migration failed: ${databaseErrorCode(error)}. Application start cancelled.`);
    return false;
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await prepareDatabase() ? 0 : 1;
}
