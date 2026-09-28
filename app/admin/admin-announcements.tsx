"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type AdminAnnouncementRow = { id: string; message: string; recipientEmail: string | null; createdAt: string };
type AdminClient = { email: string; displayName: string };

// "Кому" used to be a search box that filtered a native <select> you then
// had to separately open and pick from - two disconnected steps for one
// action, and only ever one recipient at a time. This is a single typeahead
// instead (type to search, click a match to add it as a chip, repeat for
// more than one person) - the same interaction as an email client's "To:"
// field. No specific recipients selected reads as "Все клиенты", same
// meaning as the old empty-select default.
export function AdminAnnouncements({ users, rows }: { users: AdminClient[]; rows: AdminAnnouncementRow[] }) {
  const router = useRouter();
  const [recipients, setRecipients] = useState<AdminClient[]>([]);
  const [query, setQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return [];
    const picked = new Set(recipients.map((item) => item.email));
    return users
      .filter((item) => !picked.has(item.email))
      .filter((item) => [item.email, item.displayName].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)))
      .slice(0, 8);
  }, [normalizedQuery, users, recipients]);

  function addRecipient(client: AdminClient) {
    setRecipients((current) => current.some((item) => item.email === client.email) ? current : [...current, client]);
    setQuery("");
    setSuggestOpen(false);
    searchInputRef.current?.focus();
  }
  function removeRecipient(email: string) {
    setRecipients((current) => current.filter((item) => item.email !== email));
  }

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
        body: JSON.stringify({ message: text, recipientEmails: recipients.map((item) => item.email) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Не удалось отправить.");
      setMessage("");
      setRecipients([]);
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
          <p>Сообщение появится в рабочем пространстве, в разделе «Новости» — в приложении, без email.</p>
        </div>
      </div>
      <div className="admin-announcement-field">
        <span id="admin-recipient-label">Кому</span>
        <div className="admin-client-picker">
          <div className="admin-client-picker-chips">
            {recipients.length === 0
              ? <span className="admin-client-picker-chip is-all">Все клиенты</span>
              : recipients.map((item) => (
                <span className="admin-client-picker-chip" key={item.email} title={item.email}>
                  {item.displayName}
                  <button type="button" aria-label={`Убрать ${item.displayName} из получателей`} onClick={() => removeRecipient(item.email)}>×</button>
                </span>
              ))}
            <div className="admin-client-picker-search">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSuggestOpen(true); }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
                placeholder={recipients.length ? "Добавить ещё…" : "Имя или email, чтобы выбрать конкретных клиентов"}
                aria-labelledby="admin-recipient-label"
                autoComplete="off"
              />
              {suggestOpen && suggestions.length > 0 && <div className="admin-client-picker-suggestions" role="listbox" aria-label="Клиенты">
                {suggestions.map((item) => (
                  <button type="button" role="option" aria-selected={false} key={item.email} onMouseDown={(event) => { event.preventDefault(); addRecipient(item); }}>
                    <b>{item.displayName}</b><small>{item.email}</small>
                  </button>
                ))}
              </div>}
            </div>
          </div>
        </div>
      </div>
      <label className="admin-announcement-field">Сообщение
        <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Например: мы обновили редакторы КЛИО — теперь доступно 15 режимов…" />
      </label>
      <div className="admin-control-actions">
        <button type="button" disabled={busy} onClick={() => void send()}>
          {busy ? "Отправляем…" : recipients.length === 0 ? "Отправить всем" : recipients.length === 1 ? "Отправить этому клиенту" : `Отправить ${recipients.length} клиентам`}
        </button>
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
