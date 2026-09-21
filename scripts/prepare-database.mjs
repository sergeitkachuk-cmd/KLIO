import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDatabaseConnection } from "../db/connection.mjs";

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
  for (const code of ["ERR_INVALID_URL", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "28P01", "42501", "3D000", "42P01", "42703", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    if (output.includes(code) || result.error?.code === code) return code;
  }
  if (result.error || result.signal) return "PROCESS_FAILED";
  return "NO_SUCCESS_CONFIRMATION";
}

export function prepareDatabase({ env = process.env, cwd = process.cwd(), run = spawnSync, log = console.log } = {}) {
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
  process.exitCode = prepareDatabase() ? 0 : 1;
}
