"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type AdminAnnouncementRow = { id: string; message: string; recipientEmail: string | null; createdAt: string };
type AdminClient = { email: string; displayName: string };

export function AdminAnnouncements({ users, rows }: { users: AdminClient[]; rows: AdminAnnouncementRow[] }) {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;
    return users.filter((item) => [item.email, item.displayName].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  }, [normalizedQuery, users]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function send() {
    const text = message.trim();
    if (!text) {
      setStatus("Напишите сообщение.");
      return;
    }
    setBusy(true);
    setStatus("Отправляем…");
    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, recipientEmail: recipient || undefined }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Не удалось отправить.");
      setMessage("");
      setStatus("Отправлено");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-block admin-announcements">
      <div className="admin-block-heading">
        <div>
          <h2>Написать клиентам</h2>
          <p>Сообщение появится в рабочем пространстве, в разделе «Задать вопрос» — в приложении, без email.</p>
        </div>
      </div>
      <label className="admin-announcement-field">Кому
        <div className="admin-client-picker">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по email или имени" aria-label="Поиск клиента" />
          <select value={recipient} onChange={(event) => setRecipient(event.target.value)}>
            <option value="">Все клиенты</option>
            {filteredUsers.map((item) => <option key={item.email} value={item.email}>{item.displayName} — {item.email}</option>)}
          </select>
        </div>
      </label>
      <label className="admin-announcement-field">Сообщение
        <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Например: мы обновили редакторы КЛИО — теперь доступно 15 режимов…" />
      </label>
      <div className="admin-control-actions">
        <button type="button" disabled={busy} onClick={() => void send()}>{busy ? "Отправляем…" : recipient ? "Отправить этому клиенту" : "Отправить всем"}</button>
      </div>
      {status && <p className="admin-muted">{status}</p>}
      <div className="admin-announcements-list">
        {rows.map((row) => (
          <div className="admin-announcement-row" key={row.id}>
            <div className="admin-announcement-row-head">
              <span>{row.recipientEmail ?? "Всем клиентам"}</span>
              <small>{row.createdAt}</small>
            </div>
            <p>{row.message}</p>
          </div>
        ))}
        {!rows.length && <p className="admin-muted">Пока ничего не отправлено.</p>}
      </div>
    </section>
  );
}
