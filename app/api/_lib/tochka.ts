const TOCHKA_BASE_URL = "https://enter.tochka.com/uapi";

export class TochkaConfigError extends Error {}

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
    const customers = await tochkaRequest<unknown>("/customers");
    customerCode = findString(customers, "customerCode");
  }
  if (!customerCode) throw new TochkaConfigError("Точка не вернула customerCode вашей компании.");
  let merchantId = configured.merchantId;
  if (!merchantId) {
    const retailers = await tochkaRequest<unknown>(`/acquiring/v1.0/retailers?customerCode=${encodeURIComponent(customerCode)}`);
    merchantId = findRetailerId(retailers);
  }
  return { customerCode, merchantId };
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
  for (const [key, item] of Object.entries(value)) {
    if (key === "merchantId" && typeof item === "string") return item;
    const nested = findRetailerId(item);
    if (nested) return nested;
  }
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
      ? body.message : `Точка вернула ошибку ${response.status}.`;
    throw new Error(message);
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
    if (["redirectUrl", "paymentUrl", "url"].includes(key) && typeof item === "string" && /^https?:\/\//i.test(item)) return item;
    const result = extractPaymentUrl(item);
    if (result) return result;
  }
  return null;
}
