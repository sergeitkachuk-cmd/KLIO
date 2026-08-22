import { createPublicKey, createVerify, type JsonWebKey as NodeJsonWebKey } from "node:crypto";

const TOCHKA_BASE_URL = "https://enter.tochka.com/uapi";
const TOCHKA_WEBHOOK_KEY_URL = "https://enter.tochka.com/doc/openapi/static/keys/public";

export class TochkaConfigError extends Error {}

type TochkaWebhookClaims = Record<string, unknown>;

let webhookKeyPromise: Promise<NodeJsonWebKey> | undefined;

async function webhookKey() {
  webhookKeyPromise ??= fetch(TOCHKA_WEBHOOK_KEY_URL, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Tochka public key request failed (${response.status}).`);
      const value = await response.json() as NodeJsonWebKey | { keys?: NodeJsonWebKey[] };
      return "keys" in value && Array.isArray(value.keys) ? value.keys[0] : value as NodeJsonWebKey;
    });
  return webhookKeyPromise;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export async function verifyTochkaWebhook(raw: string): Promise<TochkaWebhookClaims | null> {
  const parts = raw.trim().split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: TochkaWebhookClaims;
  try {
    header = JSON.parse(decodeBase64Url(parts[0])) as Record<string, unknown>;
    claims = JSON.parse(decodeBase64Url(parts[1])) as TochkaWebhookClaims;
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const key = await webhookKey();
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const publicKey = createPublicKey({ key, format: "jwk" });
  if (!verifier.verify(publicKey, Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"))) return null;
  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

function credentials() {
  const token = process.env.TOCHKA_JWT_TOKEN?.trim();
  const clientId = process.env.TOCHKA_CLIENT_ID?.trim();
  const customerCode = process.env.TOCHKA_CUSTOMER_CODE?.trim();
  const merchantId = process.env.TOCHKA_MERCHANT_ID?.trim();
  if (!token || !clientId) throw new TochkaConfigError("Платежи пока не настроены: добавьте ключ Точки и Client_ID.");
  return { token, clientId, customerCode, merchantId };
}

export function tochkaCustomerCode() {
  return credentials().customerCode;
}

export function tochkaMerchantId() {
  return credentials().merchantId;
}

export async function discoverTochkaIds() {
  const configured = credentials();
  let customerCode = configured.customerCode;
  if (!customerCode) {
    const customers = await tochkaRequest<unknown>("/open-banking/v1.0/customers");
    customerCode = findBusinessCustomerCode(customers) || findString(customers, "customerCode");
  }
  if (!customerCode) throw new TochkaConfigError("Точка не вернула customerCode вашей компании.");
  let merchantId = configured.merchantId;
  if (!merchantId) {
    const retailers = await tochkaRequest<unknown>(`/acquiring/v1.0/retailers?customerCode=${encodeURIComponent(customerCode)}`);
    merchantId = findRetailerId(retailers);
  }
  return { customerCode, merchantId };
}

function findBusinessCustomerCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(findBusinessCustomerCode).find(Boolean);
  const record = value as Record<string, unknown>;
  if (record.customerType === "Business" && typeof record.customerCode === "string") return record.customerCode;
  for (const item of Object.values(record)) {
    const nested = findBusinessCustomerCode(item);
    if (nested) return nested;
  }
  return undefined;
}

function findString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map((item) => findString(item, key)).find(Boolean);
  for (const [name, item] of Object.entries(value)) {
    if (name === key && typeof item === "string") return item;
    const nested = findString(item, key);
    if (nested) return nested;
  }
  return undefined;
}

function findRetailerId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(findRetailerId).find(Boolean);
  const record = value as Record<string, unknown>;
  const merchantId = typeof record.merchantId === "number" && Number.isInteger(record.merchantId)
    ? String(record.merchantId)
    : typeof record.merchantId === "string" ? record.merchantId : undefined;
  const active = record.isActive === true || record.isActive === "true" || record.isActive === "TRUE";
  if (String(record.status ?? "").toUpperCase() === "REG" && active && merchantId) return merchantId;
  for (const item of Object.values(record)) {
    const nested = findRetailerId(item);
    if (nested) return nested;
  }
  // Some API responses omit the status fields on the retailer wrapper. If the
  // acquiring application has already been approved, its merchantId is still
  // the identifier required by Create Payment Operation.
  if (merchantId && /^\d{8,}$/.test(merchantId)) return merchantId;
  return undefined;
}

export async function tochkaRequest<T>(path: string, init: RequestInit = {}) {
  const { token, clientId } = credentials();
  const response = await fetch(`${TOCHKA_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Client-Id": clientId,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message : `Точка вернула ошибку ${response.status} для ${path}.`;
    const details = body && typeof body === "object" && "Errors" in body && Array.isArray(body.Errors)
      ? (body.Errors as unknown[]).map((item) => item && typeof item === "object" && "message" in item && typeof item.message === "string" ? item.message : "").filter(Boolean).join("; ")
      : "";
    throw new Error(`Tochka API ${response.status} for ${path}: ${details || message}`);
  }
  return body as T;
}

export function extractPaymentUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const result = extractPaymentUrl(item); if (result) return result; }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
    if (["redirecturl", "paymenturl", "paymentlink", "paymentlinkurl", "url", "link"].includes(normalizedKey)
      && typeof item === "string" && /^https?:\/\//i.test(item)) return item;
    const result = extractPaymentUrl(item);
    if (result) return result;
  }
  return null;
}
