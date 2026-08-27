"use client";

import { useCallback, useEffect, useState } from "react";

type Invoice = { id: string; planId: string; billing: string; amountKopecks: number; buyerName: string; paymentStatus: string; paidAt: string | null; closingDocumentId: string | null; createdAt: string };
const names: Record<string, string> = { start: "Старт", pro: "Профи", agency: "Агентство" };

export default function InvoiceDocuments() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | "all" | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/payments/tochka/invoice/list", { cache: "no-store" }); const value = await response.json().catch(() => ({})); if (response.ok) setRows(value.invoices || []); }, []);
  useEffect(() => { const initial = window.setTimeout(() => { void load(); }, 0); const timer = window.setInterval(() => { void load(); }, 30000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [load]);
  const check = useCallback(async (id: string) => {
    setBusy(id); setError("");
    try { const response = await fetch("/api/payments/tochka/invoice/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: id }) }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || "Не удалось проверить оплату."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось проверить оплату."); }
    finally { setBusy(null); }
  }, [load]);
  const removable = rows.filter((row) => !row.paidAt && !row.closingDocumentId && row.paymentStatus !== "payment_paid");
  const remove = useCallback(async (id: string) => {
    if (!window.confirm("Удалить этот неоплаченный счёт из кабинета? Оплаченные счета и УПД удалить нельзя.")) return;
    setDeleting(id); setError("");
    try { const response = await fetch("/api/payments/tochka/invoice/list", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: id }) }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || "Не удалось удалить счёт."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось удалить счёт."); }
    finally { setDeleting(null); }
  }, [load]);
  const clearUnpaid = useCallback(async () => {
    if (!removable.length || !window.confirm(`Удалить все неоплаченные счета (${removable.length})? Оплаченные счета и УПД останутся.`)) return;
    setDeleting("all"); setError("");
    try { const response = await fetch("/api/payments/tochka/invoice/list", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allUnpaid: true }) }); const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || "Не удалось удалить счета."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось удалить счета."); }
    finally { setDeleting(null); }
  }, [load, removable.length]);
  // "not_found" means Tochka has no record of this document any more (see
  // invoice/status/route.ts) — re-checking it can never succeed, so it's
  // excluded here to stop the poll below from hammering Tochka's API for it
  // forever (that ran unnoticed for hours on 2026-08-24).
  const checkable = useCallback((row: Invoice) => !row.closingDocumentId && row.paymentStatus !== "payment_paid" && row.paymentStatus !== "not_found", []);
  useEffect(() => {
    if (!rows.some(checkable)) return;
    const timer = window.setInterval(() => {
      rows.filter(checkable).forEach((row) => { void check(row.id); });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [rows, check, checkable]);
  if (!rows.length) return null;
  return <div className="account-documents"><div className="account-documents-heading"><div><h3>Счета и закрывающие документы</h3><p>После оплаты счёта КЛИО автоматически сформирует УПД ДОП без НДС.</p></div>{removable.length > 0 && <button className="account-documents-clear" type="button" onClick={() => void clearUnpaid()} disabled={deleting !== null}>{deleting === "all" ? "Удаляем…" : `Удалить неоплаченные (${removable.length})`}</button>}</div>{error && <b className="account-billing-error">{error}</b>}{rows.map((row) => <div className="account-document" key={row.id}><div><strong>Тариф «{names[row.planId] || row.planId}» · {row.amountKopecks / 100} ₽</strong><small>{row.buyerName} · {new Date(row.createdAt).toLocaleDateString("ru-RU")}</small></div><div className="account-document-actions">{row.closingDocumentId ? <a href={`/api/payments/tochka/closing/${encodeURIComponent(row.closingDocumentId)}`} target="_blank" rel="noreferrer">Скачать УПД</a> : row.paymentStatus === "not_found" ? <small>Счёт аннулирован в Точке — удалите и создайте новый</small> : <button type="button" onClick={() => void check(row.id)} disabled={busy === row.id || deleting !== null}>{busy === row.id ? "Проверяем…" : row.paymentStatus === "payment_paid" ? "Сформировать УПД" : "Проверить оплату"}</button>}{removable.includes(row) && <button className="account-document-delete" type="button" onClick={() => void remove(row.id)} disabled={deleting !== null}>{deleting === row.id ? "Удаляем…" : "Удалить"}</button>}</div></div>)}</div>;
}
