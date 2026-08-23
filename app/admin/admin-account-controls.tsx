"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AdminUser = { email: string; displayName: string; planId: string; planName: string; planExpiresAt: string | null };

export function AdminAccountControls({ users }: { users: AdminUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(users[0]?.email ?? "");
  const selected = users.find((user) => user.email === email) ?? users[0];
  const [planId, setPlanId] = useState(selected?.planId ?? "trial");
  const [months, setMonths] = useState("1");
  const [message, setMessage] = useState("");
  async function save(clear = false) {
    setMessage("Сохраняем…");
    const response = await fetch("/api/admin/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, planId: clear ? "trial" : planId, months: clear ? 0 : Number(months) || 0 }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) { setMessage(data?.error ?? "Не удалось сохранить"); return; }
    setMessage(clear ? "Тариф очищен" : "Тариф обновлён");
    router.refresh();
  }
  return <section className="admin-block admin-account-controls">
    <div className="admin-block-heading"><div><h2>Управление тарифами</h2><p>Назначайте план и продлевайте доступ клиенту. Нулевое количество месяцев очищает платный тариф.</p></div></div>
    {!users.length ? <p className="admin-muted">Пользователей пока нет.</p> : <div className="admin-controls-grid">
      <label>Клиент<select value={email} onChange={(event) => { setEmail(event.target.value); const next = users.find((item) => item.email === event.target.value); setPlanId(next?.planId ?? "trial"); }}>{users.map((item) => <option key={item.email} value={item.email}>{item.displayName} — {item.email}</option>)}</select></label>
      <label>Тариф<select value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="trial">Пробный</option><option value="start">Старт</option><option value="pro">Профи</option><option value="agency">Агентство</option></select></label>
      <label>Добавить месяцев<input type="number" min="1" max="120" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
      <div className="admin-control-actions"><button type="button" onClick={() => void save()}>Сохранить тариф</button><button type="button" className="admin-danger-button" onClick={() => void save(true)}>Очистить</button></div>
    </div>}
    {selected && <p className="admin-muted">Текущий тариф: {selected.planName}; до {selected.planExpiresAt ? new Date(selected.planExpiresAt).toLocaleDateString("ru-RU") : "не ограничен / пробный период"}. {message}</p>}
  </section>;
}
