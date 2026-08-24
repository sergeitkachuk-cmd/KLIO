"use client";
 /* eslint-disable @next/next/no-html-link-for-pages */

 import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
 import { useSearchParams } from "next/navigation";
 import { BILLING_PERIODS, periodAmount, PLAN_PRICES, type BillingPeriod } from "@/app/billing-pricing";

const plans: Record<string, { name: string; monthly: number; yearly: number }> = PLAN_PRICES;
const testPlan = { name: "Тестовый тариф", monthly: 1, yearly: 1 };

 type CompanySuggestion = {
   inn: string;
   type: "legal_entity" | "sole_proprietor";
   display_name: string;
   full_name: string;
   kpp: string | null;
   ogrn: string | null;
   address: string | null;
   status: string | null;
 };

 function InvoiceForm() {
   const params = useSearchParams();
  const queryPlanId = params.get("planId");
  const queryBilling = params.get("billing");
  const isTestInvoice = queryPlanId === "test" && params.get("test") === "1";
  const availablePlans = isTestInvoice ? { ...plans, test: testPlan } : plans;
  const initialPlanId = queryPlanId && availablePlans[queryPlanId] ? queryPlanId : "start";
  const initialBilling = isTestInvoice ? "monthly" : (BILLING_PERIODS.some((item) => item.id === queryBilling) ? queryBilling as BillingPeriod : "monthly");
   const [planId, setPlanId] = useState(initialPlanId);
   const [billing, setBilling] = useState<BillingPeriod>(initialBilling);
   const [type, setType] = useState<"company" | "ip">("company");
   const [form, setForm] = useState({ name: "", inn: "", kpp: "", legalAddress: "", email: "" });
   const [lookupQuery, setLookupQuery] = useState("");
   const [lookupResults, setLookupResults] = useState<CompanySuggestion[]>([]);
   const [lookupBusy, setLookupBusy] = useState(false);
   const [lookupError, setLookupError] = useState("");
   const [lookupOpen, setLookupOpen] = useState(false);
   const suppressLookup = useRef(false);
   const [accepted, setAccepted] = useState(false);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const [result, setResult] = useState<{ invoiceUrl: string; amount: number; invoiceNumber?: string; paymentPurpose?: string } | null>(null);
   const [copied, setCopied] = useState(false);
  const plan = availablePlans[planId] || plans.start;
   const amount = periodAmount(plan.monthly, plan.yearly, billing);
   useEffect(() => {
     document.querySelectorAll<HTMLAnchorElement>("a.invoice-back").forEach((link) => {
       link.href = "/account#billing";
     });
   }, [result]);
   const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

   async function searchCompanies(query = lookupQuery) {
     const cleanQuery = query.trim();
     if (cleanQuery.length < 3) {
       setLookupResults([]);
       setLookupOpen(false);
       setLookupError("");
       return;
     }
     setLookupBusy(true);
     setLookupError("");
     try {
       const response = await fetch("/api/company-lookup", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ query: cleanQuery }),
       });
       const payload = await response.json().catch(() => ({}));
       if (response.status === 401) {
         window.location.assign(`/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`);
         return;
       }
       if (!response.ok) throw new Error(payload.error || "Поиск реквизитов временно недоступен.");
       setLookupResults(Array.isArray(payload.companies) ? payload.companies : []);
       setLookupOpen(true);
     } catch (caught) {
       setLookupResults([]);
       setLookupOpen(false);
       setLookupError(caught instanceof Error ? caught.message : "Поиск реквизитов временно недоступен.");
     } finally {
       setLookupBusy(false);
     }
   }

   useEffect(() => {
     if (suppressLookup.current) {
       suppressLookup.current = false;
       return;
     }
     const timer = window.setTimeout(() => void searchCompanies(), 500);
     return () => window.clearTimeout(timer);
     // searchCompanies intentionally reads the current query from state.
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [lookupQuery]);

   function selectCompany(company: CompanySuggestion) {
     suppressLookup.current = true;
     setType(company.type === "sole_proprietor" ? "ip" : "company");
     setForm((current) => ({
       ...current,
       name: company.full_name || company.display_name,
       inn: company.inn,
       kpp: company.kpp || "",
       legalAddress: company.address || current.legalAddress,
     }));
     setLookupQuery(company.display_name || company.full_name);
     setLookupResults([]);
     setLookupOpen(false);
     setLookupError("");
   }

   async function submit(event: FormEvent) {
     event.preventDefault();
     setError("");
     if (!accepted) {
       setError("Подтвердите согласие с офертой и политикой обработки данных.");
       return;
     }
     setBusy(true);
     try {
       const response = await fetch("/api/payments/tochka/invoice", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billing: isTestInvoice ? "monthly" : billing, buyer: { ...form, type } }),
       });
       const payload = await response.json().catch(() => ({}));
       if (response.status === 401) {
         window.location.assign(`/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`);
         return;
       }
       if (!response.ok || !payload.invoiceUrl) throw new Error(payload.error || "Не удалось создать счёт.");
       setResult({ invoiceUrl: payload.invoiceUrl, amount: payload.amount, invoiceNumber: payload.invoiceNumber, paymentPurpose: payload.paymentPurpose });
     } catch (caught) {
       setError(caught instanceof Error ? caught.message : "Не удалось создать счёт.");
     } finally {
       setBusy(false);
     }
   }

   if (result) return <main className="invoice-page"><a className="invoice-back" href="/#pricing">← Вернуться к тарифам</a><div className="invoice-card"><p className="kicker">Счёт создан</p><h1>Счёт для тарифа «{plan.name}»<span className="klio-mark-dot">.</span></h1><p>Сумма: <strong>{result.amount.toLocaleString("ru-RU")} ₽</strong>. Скачайте PDF и передайте его бухгалтерии.</p><div className="invoice-payment-warning"><strong>Важно для оплаты</strong><p>Скопируйте назначение платежа полностью. Номер счёта нужен для автоматической идентификации платежа; без него зачисление и активация тарифа могут задержаться.</p><div className="invoice-purpose">{result.paymentPurpose || `Оплата по счёту № ${result.invoiceNumber || "—"} за подписку «КЛИО — Цифровая редакция», тариф «${plan.name}», ${BILLING_PERIODS.find((item) => item.id === billing)?.label || billing}. Без НДС.`}</div><button type="button" className="invoice-copy" onClick={() => { const purpose = result.paymentPurpose || ""; if (purpose) void navigator.clipboard.writeText(purpose).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }}>{copied ? "Назначение скопировано" : "Скопировать назначение платежа"}</button></div><a className="invoice-primary" href={result.invoiceUrl} target="_blank" rel="noreferrer">Скачать счёт PDF</a><p className="invoice-note">После оплаты нажмите «Проверить оплату» в личном кабинете, если тариф не активировался автоматически.</p></div></main>;

   return <main className="invoice-page"><a className="invoice-back" href="/#pricing">← Вернуться к тарифам</a><div className="invoice-card"><p className="kicker">Оплата по счёту</p><h1>Счёт для бизнеса<span className="klio-mark-dot">.</span></h1><p className="invoice-lead">Заполните реквизиты покупателя — счёт сформируется в Точке.</p><form onSubmit={submit}><label>Тариф<select value={planId} onChange={(event) => setPlanId(event.target.value)}>{Object.entries(plans).map(([id, value]) => <option key={id} value={id}>{value.name} — {periodAmount(value.monthly, value.yearly, billing).toLocaleString("ru-RU")} ₽</option>)}</select></label><label>Период<select value={billing} onChange={(event) => setBilling(event.target.value as BillingPeriod)}>{BILLING_PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}{period.discount ? ` (−${period.discount}%)` : ""}</option>)}</select></label><div className="invoice-type"><label><input type="radio" checked={type === "company"} onChange={() => setType("company")} /> Организация</label><label><input type="radio" checked={type === "ip"} onChange={() => setType("ip")} /> ИП</label></div><label className="invoice-lookup-label">Поиск реквизитов по ИНН или названию<div className="invoice-lookup"><input value={lookupQuery} onChange={(event) => { setLookupQuery(event.target.value); setLookupOpen(true); }} placeholder="Например, Медиалипас или 1001346236" /><button type="button" onClick={() => void searchCompanies()} disabled={lookupBusy || lookupQuery.trim().length < 3}>{lookupBusy ? "Ищем…" : "Найти"}</button></div>{lookupError && <span className="invoice-lookup-status invoice-lookup-error">{lookupError}</span>}{lookupOpen && lookupResults.length > 0 && <div className="invoice-suggestions">{lookupResults.map((company) => <button type="button" className="invoice-suggestion" key={`${company.inn}-${company.ogrn || company.display_name}`} onClick={() => selectCompany(company)}><span className="invoice-suggestion-name">{company.display_name || company.full_name}</span><span className="invoice-suggestion-meta">ИНН {company.inn}{company.kpp ? ` · КПП ${company.kpp}` : ""}{company.address ? ` · ${company.address}` : ""}</span></button>)}</div>}{lookupOpen && !lookupBusy && lookupQuery.trim().length >= 3 && !lookupError && lookupResults.length === 0 && <span className="invoice-lookup-status">Ничего не найдено. Проверьте написание или заполните реквизиты вручную.</span>}</label><label>{type === "company" ? "Название организации" : "ФИО ИП"}<input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder={type === "company" ? "ООО «Название»" : "Иванов Иван Иванович"} /></label><div className="invoice-two"><label>ИНН<input required value={form.inn} onChange={(event) => update("inn", event.target.value)} inputMode="numeric" /></label>{type === "company" && <label>КПП<input required value={form.kpp} onChange={(event) => update("kpp", event.target.value)} inputMode="numeric" /></label>}</div><label>Юридический адрес<input required value={form.legalAddress} onChange={(event) => update("legalAddress", event.target.value)} placeholder="Адрес регистрации" /></label><label>E-mail для связи<input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="бухгалтерия@company.ru" /></label><label className="invoice-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Соглашаюсь с <a href="/legal/offer" target="_blank">публичной офертой</a> и <a href="/legal/privacy" target="_blank">политикой обработки персональных данных</a>.</span></label>{error && <p className="invoice-error">{error}</p>}<button className="invoice-primary" type="submit" disabled={busy || !accepted}>{busy ? "Создаём счёт…" : `Создать счёт на ${amount.toLocaleString("ru-RU")} ₽`}</button></form></div></main>;
 }

export default function InvoicePage() { return <Suspense fallback={<main className="invoice-page"><div className="invoice-card">Загрузка…</div></main>}><InvoiceForm /></Suspense>; }
