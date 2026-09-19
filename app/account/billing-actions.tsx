"use client";
import { useEffect, useRef, useState } from "react";
import {
  BILLING_PERIODS,
  periodAmount,
  applyLaunchDiscount,
  LAUNCH_DISCOUNT_PERCENT,
  LAUNCH_DISCOUNT_BILLING,
  type BillingPeriod,
} from "@/app/billing-pricing";
import { trackMetricaGoal } from "@/app/analytics-consent";
import { waitForPaymentConfirmation } from "../payment-confirmation";

const plans = [
  { id: "start", name: "Старт", monthly: 1190, yearly: 950 },
  { id: "pro", name: "Профи", monthly: 2750, yearly: 2200 },
  { id: "agency", name: "Агентство", monthly: 6590, yearly: 5290 },
] as const;
type SelectOption = { value: string; label: string };

export function StyledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="account-select" ref={rootRef}>
      <span className="account-select-label">{label}</span>
      <button
        type="button"
        className={`account-select-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        <span>{selected?.label}</span>
        <span className="account-select-chevron">⌄</span>
      </button>
      {open && (
        <div className="account-select-menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`account-select-option${option.value === value ? " is-selected" : ""}`}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BillingActions({
  launchDiscountAvailable = false,
}: {
  launchDiscountAvailable?: boolean;
}) {
  const [planId, setPlanId] = useState<(typeof plans)[number]["id"]>("start");
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<"sbp" | "card" | null>(null);
  const [error, setError] = useState("");
  const paymentBusy = useRef(false);
  const [checking, setChecking] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [canCheck, setCanCheck] = useState(false);
  const plan = plans.find((item) => item.id === planId) || plans[0];
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const paymentLinkId = query.get("paymentLinkId");
    if (query.get("payment") !== "success" || !paymentLinkId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setChecking(true);
        setCanCheck(true);
        setError("");
      }
    });
    void waitForPaymentConfirmation(paymentLinkId, {
      signal: controller.signal,
    })
      .then((status) => {
        if (controller.signal.aborted) return;
        if (status === "paid") {
          trackMetricaGoal("payment_completed");
          window.location.replace("/account?payment=confirmed");
        } else if (status === "refunded")
          setError("По этому платежу оформлен возврат.");
        else if (status === "expired")
          setError(
            "Срок платёжной ссылки истёк. Если деньги списаны, обратитесь в поддержку.",
          );
        else
          setError(
            "Банк пока не подтвердил оплату. Если деньги списаны, не платите повторно — нажмите «Проверить оплату» чуть позже.",
          );
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error && caught.name !== "TimeoutError"
              ? caught.message
              : "Проверка заняла слишком много времени. Попробуйте проверить оплату ещё раз.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [checkAttempt]);
  const periodOptions = BILLING_PERIODS.map((period) => {
    const base = periodAmount(plan.monthly, plan.yearly, period.id);
    // Server independently recomputes and applies this same discount at
    // checkout (never trusts a client-sent amount) — this is display only.
    if (launchDiscountAvailable && period.id === LAUNCH_DISCOUNT_BILLING) {
      return {
        value: period.id,
        label: `${period.label} — ${applyLaunchDiscount(base).toLocaleString("ru-RU")} ₽ (−${LAUNCH_DISCOUNT_PERCENT}% для первых клиентов)`,
      };
    }
    return {
      value: period.id,
      label: `${period.label} — ${base.toLocaleString("ru-RU")} ₽${period.discount ? ` (−${period.discount}%)` : ""}`,
    };
  });
  async function pay(mode: "sbp" | "card") {
    if (!accepted || paymentBusy.current || checking) return;
    paymentBusy.current = true;
    setBusy(mode);
    setError("");
    try {
      const response = await fetch("/api/payments/tochka/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billing, mode }),
        signal: AbortSignal.timeout(100_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.paymentUrl)
        throw new Error(
          payload.error || "Не удалось создать ссылку на оплату.",
        );
      const destination = new URL(payload.paymentUrl);
      if (
        destination.protocol !== "https:" ||
        destination.username ||
        destination.password
      )
        throw new Error("Банк вернул некорректную ссылку на оплату.");
      window.location.assign(destination.href);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось создать ссылку на оплату.",
      );
      setBusy(null);
      paymentBusy.current = false;
    }
  }
  return (
    <div className="account-billing-actions">
      <div className="account-billing-selects">
        <StyledSelect
          label="Тариф"
          value={planId}
          onChange={(value) => setPlanId(value as typeof planId)}
          options={plans.map((item) => ({ value: item.id, label: item.name }))}
        />
        <StyledSelect
          label="Период"
          value={billing}
          onChange={(value) => setBilling(value as BillingPeriod)}
          options={periodOptions}
        />
      </div>
      <label className="account-billing-consent">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>
          Соглашаюсь с{" "}
          <a href="/legal/offer" target="_blank" rel="noreferrer">
            публичной офертой
          </a>
          ,{" "}
          <a href="/legal/privacy" target="_blank" rel="noreferrer">
            политикой обработки персональных данных
          </a>{" "}
          и{" "}
          <a href="/legal/refunds" target="_blank" rel="noreferrer">
            правилами возврата
          </a>
          .
        </span>
      </label>
      <div className="account-billing-buttons">
        <button
          type="button"
          disabled={!accepted || Boolean(busy) || checking}
          onClick={() => pay("sbp")}
        >
          {busy === "sbp" ? "Открываем…" : "Оплатить через СБП"}
        </button>
        <button
          type="button"
          disabled={!accepted || Boolean(busy) || checking}
          onClick={() => pay("card")}
        >
          {busy === "card" ? "Открываем…" : "Оплатить картой"}
        </button>
        <a href={`/invoice?planId=${planId}&billing=${billing}`}>
          Получить счёт
        </a>
      </div>
      {checking && <p role="status">Проверяем подтверждение оплаты…</p>}
      {error && <p className="account-billing-error" role="alert">{error}</p>}
      {canCheck && !checking && <button type="button" onClick={() => setCheckAttempt(value => value + 1)}>Проверить оплату</button>}
    </div>
  );
}
