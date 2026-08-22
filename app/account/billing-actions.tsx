"use client";

import { useState } from "react";

const plans = [
  { id: "start", name: "Старт", monthly: 1190, yearly: 950 },
  { id: "pro", name: "Профи", monthly: 2750, yearly: 2200 },
  { id: "agency", name: "Агентство", monthly: 6590, yearly: 5290 },
] as const;

export default function BillingActions() {
  const [planId, setPlanId] = useState<(typeof plans)[number]["id"]>("start");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<"sbp" | "card" | null>(null);
  const [error, setError] = useState("");
  const plan = plans.find((item) => item.id === planId) || plans[0];
  const amount = billing === "annual" ? plan.yearly * 12 : plan.monthly;

  async function pay(mode: "sbp" | "card") {
    if (!accepted) return;
    setBusy(mode);
    setError("");
    try {
      const response = await fetch("/api/payments/tochka/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billing, mode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.paymentUrl) throw new Error(payload.error || "Не удалось создать ссылку на оплату.");
      window.location.assign(payload.paymentUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать ссылку на оплату.");
      setBusy(null);
    }
  }

  return (
    <div className="account-billing-actions">
      <div className="account-billing-selects">
        <label>Тариф<select value={planId} onChange={(event) => setPlanId(event.target.value as typeof planId)}>{plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Период<select value={billing} onChange={(event) => setBilling(event.target.value as typeof billing)}><option value="monthly">Ежемесячно — {plan.monthly.toLocaleString("ru-RU")} ₽</option><option value="annual">За год — {amount.toLocaleString("ru-RU")} ₽</option></select></label>
      </div>
      <label className="account-billing-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Соглашаюсь с <a href="/legal/offer" target="_blank" rel="noreferrer">публичной офертой</a> и <a href="/legal/privacy" target="_blank" rel="noreferrer">политикой обработки персональных данных</a>.</span></label>
      <div className="account-billing-buttons"><button type="button" disabled={!accepted || Boolean(busy)} onClick={() => pay("sbp")}>{busy === "sbp" ? "Открываем…" : "Оплатить через СБП"}</button><button type="button" disabled={!accepted || Boolean(busy)} onClick={() => pay("card")}>{busy === "card" ? "Открываем…" : "Оплатить картой"}</button><a href={`/invoice?planId=${planId}&billing=${billing}`}>Получить счёт</a></div>
      {error && <p className="account-billing-error">{error}</p>}
    </div>
  );
}
