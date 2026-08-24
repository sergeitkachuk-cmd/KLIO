"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PAYMENT_LINK_TTL_MS } from "../payment-link";

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
  const reconciledPaymentIds = useRef(new Set<string>());
  const [showPending, setShowPending] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/payments/tochka/list", { cache: "no-store" });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) { setError(value.error || "Не удалось загрузить историю оплат."); return; }
    setRows(value.payments || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const latestSettled = rows.find((row) => (row.status === "paid" || row.status === "refunded") && row.operationId && !reconciledPaymentIds.current.has(row.id));
    if (!latestSettled) return;
    reconciledPaymentIds.current.add(latestSettled.id);
    void fetch("/api/payments/tochka/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentLinkId: latestSettled.id }) })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => { if (response.ok && body.status === "refunded") void load(); });
  }, [rows, load]);
  if (!rows.length && !error) return null;
  const completed = rows.filter((row) => row.status === "paid" || row.status === "refunded");
  // Retain expired rows in the database for accounting, but a payment link
  // cannot be paid after its TTL and should not clutter the customer's view.
  const pending = rows.filter((row) => row.status !== "paid" && row.status !== "refunded" && new Date(row.createdAt).getTime() + PAYMENT_LINK_TTL_MS > Date.now());
  const rowView = (row: Payment) => <div className="account-document" key={row.id}><div><strong>Тариф «{names[row.planId] || row.planId}» · {(row.amountKopecks / 100).toLocaleString("ru-RU")} ₽</strong><small>{periods[row.billing] || row.billing} · {new Date(row.paidAt || row.createdAt).toLocaleDateString("ru-RU")}{row.operationId ? ` · Операция ${row.operationId}` : ""}</small></div><span className={`account-payment-status account-payment-status-${row.status}`}>{statusLabel(row.status)}</span></div>;
  return <div className="account-documents account-payment-history"><div className="account-documents-heading"><div><h3>Платежи и кассовые чеки</h3><p>Фискальный чек по успешной оплате направляется на email, указанный в кабинете.</p></div></div>{error && <b className="account-billing-error">{error}</b>}{completed.length > 0 ? completed.map(rowView) : <p className="account-payment-empty">Успешных оплат пока нет.</p>}{pending.length > 0 && <div className="account-pending-wrap"><button type="button" className="account-pending-toggle" onClick={() => setShowPending((value) => !value)} aria-expanded={showPending}>{showPending ? "Скрыть" : "Показать"} незавершённые оплаты ({pending.length})</button>{showPending && <div className="account-pending-list">{pending.map(rowView)}</div>}</div>}</div>;
}
