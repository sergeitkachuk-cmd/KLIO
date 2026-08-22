"use client";

import { FormEvent, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const plans: Record<string, { name: string; monthly: number; yearly: number }> = {
  start: { name: "Старт", monthly: 1190, yearly: 950 },
  pro: { name: "Профи", monthly: 2750, yearly: 2200 },
  agency: { name: "Агентство", monthly: 6590, yearly: 5290 },
};

function InvoiceForm() {
  const params = useSearchParams();
  const [planId, setPlanId] = useState("start");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [type, setType] = useState<"company" | "ip">("company");
  const [form, setForm] = useState({ name: "", inn: "", kpp: "", legalAddress: "", email: "" });
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ invoiceUrl: string; amount: number } | null>(null);

  useEffect(() => {
    const candidate = params.get("planId");
    if (candidate && plans[candidate]) setPlanId(candidate);
    if (params.get("billing") === "annual") setBilling("annual");
  }, [params]);

  const plan = plans[planId];
  const amount = billing === "annual" ? plan.yearly * 12 : plan.monthly;
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!accepted) { setError("Подтвердите согласие с офертой и политикой обработки данных."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/payments/tochka/invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, billing, buyer: { ...form, type } }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.invoiceUrl) throw new Error(payload.error || "Не удалось создать счёт.");
      setResult({ invoiceUrl: payload.invoiceUrl, amount: payload.amount });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать счёт."); }
    finally { setBusy(false); }
  }

  if (result) return <main className="invoice-page"><a className="invoice-back" href="/#pricing">← Вернуться к тарифам</a><div className="invoice-card"><p className="kicker">Счёт создан</p><h1>Счёт для тарифа «{plan.name}» готов<span className="klio-mark-dot">.</span></h1><p>Сумма: <strong>{result.amount.toLocaleString("ru-RU")} ₽</strong>. Откройте PDF, подпишите его в интернет-банке и передайте бухгалтерии.</p><a className="invoice-primary" href={result.invoiceUrl} target="_blank" rel="noreferrer">Скачать счёт PDF</a><p className="invoice-note">Статус оплаты мы проверим после зачисления средств.</p></div></main>;

  return <main className="invoice-page"><a className="invoice-back" href="/#pricing">← Вернуться к тарифам</a><div className="invoice-card"><p className="kicker">Оплата по счёту</p><h1>Счёт для бизнеса<span className="klio-mark-dot">.</span></h1><p className="invoice-lead">Способ оплаты для юридических лиц и ИП. Заполните реквизиты покупателя — счёт сформируется в Точке.</p><form onSubmit={submit}><label>Тариф<select value={planId} onChange={(event) => setPlanId(event.target.value)}>{Object.entries(plans).map(([id, value]) => <option key={id} value={id}>{value.name} — {(billing === "annual" ? value.yearly * 12 : value.monthly).toLocaleString("ru-RU")} ₽</option>)}</select></label><label>Период<select value={billing} onChange={(event) => setBilling(event.target.value as "monthly" | "annual")}><option value="monthly">Ежемесячно</option><option value="annual">За год</option></select></label><div className="invoice-type"><label><input type="radio" checked={type === "company"} onChange={() => setType("company")}/> Организация</label><label><input type="radio" checked={type === "ip"} onChange={() => setType("ip")}/> ИП</label></div><label>{type === "company" ? "Название организации" : "ФИО ИП"}<input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder={type === "company" ? "ООО «Название»" : "Иванов Иван Иванович"}/></label><div className="invoice-two"><label>ИНН<input required value={form.inn} onChange={(event) => update("inn", event.target.value)} inputMode="numeric"/></label>{type === "company" && <label>КПП<input required value={form.kpp} onChange={(event) => update("kpp", event.target.value)} inputMode="numeric"/></label>}</div><label>Юридический адрес<input required value={form.legalAddress} onChange={(event) => update("legalAddress", event.target.value)} placeholder="Адрес регистрации"/></label><label>E-mail для связи<input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder=" бухгалтерия@company.ru"/></label><label className="invoice-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)}/><span>Соглашаюсь с <a href="/legal/offer" target="_blank">публичной офертой</a> и <a href="/legal/privacy" target="_blank">политикой обработки персональных данных</a>.</span></label>{error && <p className="invoice-error">{error}</p>}<button className="invoice-primary" type="submit" disabled={busy || !accepted}>{busy ? "Создаём счёт…" : `Создать счёт на ${amount.toLocaleString("ru-RU")} ₽`}</button></form></div></main>;
}

export default function InvoicePage() { return <Suspense fallback={<main className="invoice-page"><div className="invoice-card">Загрузка…</div></main>}><InvoiceForm /></Suspense>; }
