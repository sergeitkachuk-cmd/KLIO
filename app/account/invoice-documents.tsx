"use client";

import { useEffect, useState } from "react";

type Invoice = { id: string; planId: string; billing: string; amountKopecks: number; buyerName: string; paymentStatus: string; closingDocumentId: string | null; createdAt: string };
const names: Record<string, string> = { start: "Старт", pro: "Профи", agency: "Агентство" };

export default function InvoiceDocuments() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function load() { const response = await fetch("/api/payments/tochka/invoice/list", { cache: "no-store" }); const value = await response.json().catch(() => ({})); if (response.ok) setRows(value.invoices || []); }
  useEffect(() => { void load(); const timer = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!rows.some((row) => !row.closingDocumentId && row.paymentStatus !== "payment_paid")) return;
    const timer = window.setInterval(() => {
      rows.filter((row) => !row.closingDocumentId && row.paymentStatus !== "payment_paid").forEach((row) => { void check(row.id); });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [rows]);
  async function check(id: string) {
    setBusy(id); setError("");
    try { const response = await fetch("/api/payments/tochka/invoice/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: id }) }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || "Не удалось проверить оплату."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось проверить оплату."); }
    finally { setBusy(null); }
  }
  if (!rows.length) return null;
  return <div className="account-documents"><h3>Счета и закрывающие документы</h3><p>После оплаты счёта КЛИО автоматически сформирует УПД ДОП без НДС.</p>{error && <b className="account-billing-error">{error}</b>}{rows.map((row) => <div className="account-document" key={row.id}><div><strong>Тариф «{names[row.planId] || row.planId}» · {row.amountKopecks / 100} ₽</strong><small>{row.buyerName} · {new Date(row.createdAt).toLocaleDateString("ru-RU")}</small></div><div className="account-document-actions">{row.closingDocumentId ? <a href={`/api/payments/tochka/closing/${encodeURIComponent(row.closingDocumentId)}`} target="_blank" rel="noreferrer">Скачать УПД</a> : <button type="button" onClick={() => void check(row.id)} disabled={busy === row.id}>{busy === row.id ? "Проверяем…" : row.paymentStatus === "payment_paid" ? "Сформировать УПД" : "Проверить оплату"}</button>}</div></div>)}</div>;
}
