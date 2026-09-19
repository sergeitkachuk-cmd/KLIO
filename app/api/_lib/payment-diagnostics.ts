export function paymentErrorDetail(error: unknown): string {
  let detail = error instanceof Error ? error.message : "Unknown error";
  for (const name of ["TOCHKA_JWT_TOKEN", "TOCHKA_CLIENT_ID", "TOCHKA_CUSTOMER_CODE", "TOCHKA_MERCHANT_ID", "DATABASE_URL"]) {
    const secret = process.env[name]?.trim();
    if (secret) detail = detail.split(secret).join("[скрыто]");
  }
  return detail
    .replace(/(?:Bearer|OAuth)\s+\S+/gi, "[скрыто]")
    .replace(/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+/g, "[скрыто]")
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s]+/gi, "[адрес скрыт]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email скрыт]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 600);
}
