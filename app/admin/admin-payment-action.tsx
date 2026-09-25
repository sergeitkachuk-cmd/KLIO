"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminPaymentAction({ paymentId, operationId }: { paymentId: string; operationId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"grant" | "preserve" | null>(null);
  const [message, setMessage] = useState("");

  async function recover(preserveAccess: boolean) {
    setBusy(preserveAccess ? "preserve" : "grant");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payment-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, operationId, preserveAccess }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Не удалось проверить оплату.");
      if (data?.status === "paid") {
        setMessage(preserveAccess ? "Оплата закрыта, тариф не менялся" : "Оплата подтверждена, тариф выдан");
        router.refresh();
      } else {
        setMessage(`В Точке статус: ${data?.providerStatus || data?.status || "неизвестен"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось проверить оплату.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="admin-payment-actions">
    <button type="button" disabled={Boolean(busy) || !operationId} onClick={() => void recover(false)}>{busy === "grant" ? "Проверяем…" : "Сверить и выдать"}</button>
    <button type="button" className="admin-payment-preserve" disabled={Boolean(busy) || !operationId} onClick={() => void recover(true)}>{busy === "preserve" ? "Проверяем…" : "Тариф уже выдан"}</button>
    {message && <small>{message}</small>}
  </div>;
}
