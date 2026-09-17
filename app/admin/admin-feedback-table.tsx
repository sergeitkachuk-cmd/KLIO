"use client";

import { useState } from "react";

export type AdminFeedbackRow = {
  id: string;
  ownerEmail: string;
  message: string;
  reply: string | null;
  createdAt: string;
  repliedAt: string | null;
};

function ReplyRow({ row }: { row: AdminFeedbackRow }) {
  const [draft, setDraft] = useState(row.reply ?? "");
  const [saved, setSaved] = useState(row.reply);
  const [savedAt, setSavedAt] = useState(row.repliedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(!row.reply);

  async function send() {
    const reply = draft.trim();
    if (!reply) {
      setError("Введите текст ответа.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, reply }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось отправить ответ.");
      setSaved(payload.feedback?.reply ?? reply);
      setSavedAt(payload.feedback?.repliedAt ?? new Date().toISOString());
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить ответ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{row.createdAt}</td>
      <td>{row.ownerEmail}</td>
      <td className="admin-feedback-message">{row.message}</td>
      <td className="admin-feedback-reply">
        {!editing ? (
          <>
            <p className="admin-feedback-message">{saved}</p>
            <button type="button" className="admin-details-toggle" onClick={() => { setDraft(saved ?? ""); setEditing(true); }}>Изменить ответ</button>
          </>
        ) : (
          <>
            <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Введите ответ…" />
            <div className="admin-feedback-reply-actions">
              <button type="button" className="admin-details-toggle" disabled={busy} onClick={() => void send()}>{busy ? "Отправляем…" : "Отправить"}</button>
              {saved && <button type="button" className="admin-details-toggle" disabled={busy} onClick={() => { setDraft(saved ?? ""); setEditing(false); setError(""); }}>Отмена</button>}
            </div>
            {error && <p className="admin-feedback-reply-error">{error}</p>}
          </>
        )}
      </td>
    </tr>
  );
}

export function AdminFeedbackTable({ rows }: { rows: AdminFeedbackRow[] }) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table admin-table-feedback">
        <thead><tr><th>Когда</th><th>От кого</th><th>Сообщение</th><th>Ответ</th></tr></thead>
        <tbody>
          {rows.map((row) => <ReplyRow row={row} key={row.id} />)}
          {!rows.length && <tr><td colSpan={4} className="admin-empty-row">Обращений пока не было.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
