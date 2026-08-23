"use client";
import { useEffect, useRef, useState } from "react";
import { BILLING_PERIODS, periodAmount, type BillingPeriod } from "@/app/billing-pricing";

const plans = [
  { id: "start", name: "Старт", monthly: 1190, yearly: 950 },
  { id: "pro", name: "Профи", monthly: 2750, yearly: 2200 },
  { id: "agency", name: "Агентство", monthly: 6590, yearly: 5290 },
] as const;
type SelectOption = { value: string; label: string };

export function StyledSelect({ label, value, options, onChange }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div className="account-select" ref={rootRef}><span className="account-select-label">{label}</span><button type="button" className={`account-select-trigger${open ? " is-open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((state) => !state)}><span>{selected?.label}</span><span className="account-select-chevron">⌄</span></button>{open && <div className="account-select-menu" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`account-select-option${option.value === value ? " is-selected" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</div>}</div>;
}

export default function BillingActions() {
  const [planId, setPlanId] = useState<(typeof plans)[number]["id"]>("start");
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState<"sbp" | "card" | null>(null); const [error, setError] = useState("");
  const plan = plans.find((item) => item.id === planId) || plans[0]; const amount = periodAmount(plan.monthly, plan.yearly, billing);
  const periodOptions = BILLING_PERIODS.map((period) => ({ value: period.id, label: `${period.label} — ${periodAmount(plan.monthly, plan.yearly, period.id).toLocaleString("ru-RU")} ₽${period.discount ? ` (−${period.discount}%)` : ""}` }));
  async function pay(mode: "sbp" | "card") { if (!accepted) return; setBusy(mode); setError(""); try { const response = await fetch("/api/payments/tochka/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, billing, mode }) }); const payload = await response.json().catch(() => ({})); if (!response.ok || !payload.paymentUrl) throw new Error(payload.error || "Не удалось создать ссылку на оплату."); window.location.assign(payload.paymentUrl); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать ссылку на оплату."); setBusy(null); } }
  return <div className="account-billing-actions"><div className="account-billing-selects"><StyledSelect label="Тариф" value={planId} onChange={(value) => setPlanId(value as typeof planId)} options={plans.map((item) => ({ value: item.id, label: item.name }))} /><StyledSelect label="Период" value={billing} onChange={(value) => setBilling(value as BillingPeriod)} options={periodOptions} /></div><label className="account-billing-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Соглашаюсь с <a href="/legal/offer" target="_blank" rel="noreferrer">публичной офертой</a> и <a href="/legal/privacy" target="_blank" rel="noreferrer">политикой обработки персональных данных</a>.</span></label><div className="account-billing-buttons"><button type="button" disabled={!accepted || Boolean(busy)} onClick={() => pay("sbp")}>{busy === "sbp" ? "Открываем…" : "Оплатить через СБП"}</button><button type="button" disabled={!accepted || Boolean(busy)} onClick={() => pay("card")}>{busy === "card" ? "Открываем…" : "Оплатить картой"}</button><a href={`/invoice?planId=${planId}&billing=${billing}`}>Получить счёт</a></div>{error && <p className="account-billing-error">{error}</p>}</div>;
}
