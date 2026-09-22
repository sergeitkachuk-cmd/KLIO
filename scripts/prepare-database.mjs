import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { parseDatabaseConnection } from "../db/connection.mjs";

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

export async function prepareDatabase({ env = process.env, cwd = process.cwd(), run = spawnSync, check = checkDatabaseConnection, log = console.log } = {}) {
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
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await prepareDatabase() ? 0 : 1;
}
