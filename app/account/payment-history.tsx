"use client";

import { useCallback, useEffect, useState } from "react";

type Payment = { id: string; planId: string; billing: string; amountKopecks: number; status: string; operationId: string | null; paidAt: string | null; createdAt: string };

const names: Record<string, string> = { start: "Старт", pro: "Профи", agency: "Агентство" };
const periods: Record<string, string> = { monthly: "1 месяц", quarterly: "3 месяца", halfyear: "6 месяцев", annual: "12 месяцев" };

function statusLabel(status: string) {
  if (status === "paid") return "Оплачен";
  if (status === "refunded") return "Возвращён";
  return "Ожидает оплаты";
}

export default function PaymentHistory() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/payments/tochka/list", { cache: "no-store" });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) { setError(value.error || "Не удалось загрузить историю оплат."); return; }
    setRows(value.payments || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!rows.length && !error) return null;
  return <div className="account-documents account-payment-history"><div className="account-documents-heading"><div><h3>Платежи и кассовые чеки</h3><p>Фискальный чек по успешной оплате направляется на email, указанный в кабинете.</p></div></div>{error && <b className="account-billing-error">{error}</b>}{rows.map((row) => <div className="account-document" key={row.id}><div><strong>Тариф «{names[row.planId] || row.planId}» · {(row.amountKopecks / 100).toLocaleString("ru-RU")} ₽</strong><small>{periods[row.billing] || row.billing} · {new Date(row.paidAt || row.createdAt).toLocaleDateString("ru-RU")}{row.operationId ? ` · Операция ${row.operationId}` : ""}</small></div><span className={`account-payment-status account-payment-status-${row.status}`}>{statusLabel(row.status)}</span></div>)}</div>;
}
