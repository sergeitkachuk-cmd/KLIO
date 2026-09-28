"use client";

import { useMemo, useState } from "react";

export type AdminFeedbackMessage = {
  id: string;
  ownerEmail: string;
  sender: "client" | "admin" | "bot";
  body: string;
  createdAt: string;
  readAt: string | null;
};

type Thread = {
  ownerEmail: string;
  messages: AdminFeedbackMessage[];
  lastAt: string;
  needsReply: boolean;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function senderLabel(sender: AdminFeedbackMessage["sender"]): string {
  if (sender === "client") return "Клиент";
  if (sender === "bot") return "КЛИО (бот)";
  return "Вы";
}

// Groups the flat, newest-first query result (see app/admin/page.tsx) into
// one thread per customer, each sorted oldest-first for a chat-style read.
// needsReply skips bot rows on purpose - the bot always answers a client
// message immediately (see app/api/feedback/route.ts's BOT_ACK_MESSAGE),
// so "last message is from the bot" must not read as "already answered".
function buildThreads(rows: AdminFeedbackMessage[]): Thread[] {
  const byOwner = new Map<string, AdminFeedbackMessage[]>();
  for (const row of rows) {
    const list = byOwner.get(row.ownerEmail);
    if (list) list.push(row); else byOwner.set(row.ownerEmail, [row]);
  }
  const threads: Thread[] = [];
  for (const [ownerEmail, messages] of byOwner) {
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lastNonBot = [...messages].reverse().find((item) => item.sender !== "bot");
    threads.push({
      ownerEmail,
      messages,
      lastAt: messages[messages.length - 1].createdAt,
      needsReply: lastNonBot?.sender === "client",
    });
  }
  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return threads;
}

function ThreadPane({ thread }: { thread: Thread }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<AdminFeedbackMessage[]>([]);

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
        body: JSON.stringify({ ownerEmail: thread.ownerEmail, reply }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось отправить ответ.");
      if (payload.feedback) setSent((current) => [...current, payload.feedback]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить ответ.");
    } finally {
      setBusy(false);
    }
  }

  const messages = [...thread.messages, ...sent];

  return (
    <div className="admin-feedback-thread">
      <div className="admin-feedback-thread-head">{thread.ownerEmail}</div>
      <div className="admin-feedback-bubbles">
        {messages.map((item) => (
          <div key={item.id} className={`admin-feedback-bubble is-${item.sender}`}>
            <span className="admin-feedback-bubble-sender">{senderLabel(item.sender)}</span>
            <p>{item.body}</p>
            <time>{formatDateTime(item.createdAt)}</time>
          </div>
        ))}
      </div>
      <div className="admin-feedback-reply">
        <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Введите ответ…" />
        <div className="admin-feedback-reply-actions">
          <button type="button" className="admin-details-toggle" disabled={busy} onClick={() => void send()}>{busy ? "Отправляем…" : "Отправить"}</button>
        </div>
        {error && <p className="admin-feedback-reply-error">{error}</p>}
      </div>
    </div>
  );
}

export function AdminFeedbackTable({ rows }: { rows: AdminFeedbackMessage[] }) {
  const threads = useMemo(() => buildThreads(rows), [rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const activeEmail = selected && threads.some((item) => item.ownerEmail === selected) ? selected : (threads[0]?.ownerEmail ?? null);
  const activeThread = threads.find((item) => item.ownerEmail === activeEmail) ?? null;

  if (!threads.length) {
    return <p className="admin-empty-row">Обращений пока не было.</p>;
  }

  return (
    <div className="admin-feedback-layout">
      <div className="admin-feedback-thread-list">
        {threads.map((thread) => {
          const last = thread.messages[thread.messages.length - 1];
          return (
            <button
              type="button"
              key={thread.ownerEmail}
              className={`admin-feedback-thread-item ${thread.ownerEmail === activeEmail ? "active" : ""}`}
              onClick={() => setSelected(thread.ownerEmail)}
            >
              <span className="admin-feedback-thread-item-email">{thread.ownerEmail}</span>
              <span className="admin-feedback-thread-item-preview">{last.body}</span>
              <span className="admin-feedback-thread-item-meta">
                <time>{formatDateTime(thread.lastAt)}</time>
                {thread.needsReply && <em className="admin-badge-attention admin-badge-attention-inline">ждёт ответа</em>}
              </span>
            </button>
          );
        })}
      </div>
      {activeThread && <ThreadPane thread={activeThread} key={activeThread.ownerEmail} />}
    </div>
  );
}
