"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ArrowLeft, ArrowRight, Bell, X } from "lucide-react";
import "./workspace-news.css";

type NewsItem = { id: string; message: string; createdAt: string };
function parts(message: string) {
  const lines = message.trim().split(/\n+/);
  const first = lines[0] || "Новость КЛИО";
  return first.length <= 120
    ? { title: first, body: lines.slice(1).join("\n\n") }
    : { title: `${first.slice(0, 100).trim()}…`, body: message };
}
const date = (value: string) => new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

export function WorkspaceNews({ items, onClose }: { items: NewsItem[]; onClose: () => void }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLElement>(null);
  const newsList = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find(item => item.id === selectedId);
  const index = items.findIndex(item => item.id === selectedId);
  useEffect(() => {
    const panel = drawer.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.showModal();
    return () => {
      panel?.close(); document.body.style.overflow = oldOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (reader.current) reader.current.scrollTop = 0;
    const list = newsList.current;
    const card = list?.querySelector<HTMLElement>(".news-card.is-selected");
    if (!list || !card) return;
    const bounds = list.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const inset = 14;
    const delta = rect.top < bounds.top + inset
      ? rect.top - bounds.top - inset
      : rect.bottom > bounds.bottom - inset ? rect.bottom - bounds.bottom + inset : 0;
    if (delta) list.scrollTo({ top: list.scrollTop + delta, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selected]);
  const backdropDown = useRef<EventTarget | null>(null);
  return createPortal(<dialog ref={drawer} className="workspace-news-layout" aria-label="Журнал новостей"
    onCancel={event => { event.preventDefault(); if (selected) setSelectedId(null); else onClose(); }}
    onPointerDown={event => { backdropDown.current = event.target; }}
    onClick={event => { if (event.target === drawer.current && backdropDown.current === event.target) onClose(); }}>
    <section className="workspace-news-drawer" aria-labelledby="workspace-news-title">
      <header className="news-drawer-head"><div><span><Bell size={13}/> КЛИО / ЖУРНАЛ</span><h2 id="workspace-news-title">Новости<span>{items.length}</span></h2><p>Обновления и объявления команды.</p></div><button type="button" className="news-icon-button" aria-label="Закрыть новости" onClick={onClose} autoFocus><X size={19}/></button></header>
      <div className="news-drawer-scroll" ref={newsList}>
        {items.length === 0 ? <div className="news-empty"><Bell size={30}/><h3>Здесь скоро появятся новости</h3><p>Обновления и важные объявления будут собраны в этой ленте.</p></div> : items.map((item, i) => {
          const { title, body } = parts(item.message);
          const month = new Date(item.createdAt).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
          const previousMonth = i > 0 ? new Date(items[i - 1].createdAt).toLocaleDateString("ru-RU", { month: "long", year: "numeric" }) : "";
          return <div className="news-entry" key={item.id}>
            {month !== previousMonth && <p className="news-month">{month}</p>}
            <button type="button" className={`news-card news-card-${i % 4}${selectedId === item.id ? " is-selected" : ""}`} onClick={() => setSelectedId(item.id)} aria-controls="workspace-news-article" aria-expanded={selectedId === item.id}>
              <span className="news-card-meta"><span>КЛИО / {String(i + 1).padStart(2, "0")}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></span>
              <strong>{title}</strong>{body && <span className="news-card-excerpt">{body}</span>}
              <span className="news-card-bottom">Читать новость<span className="news-card-arrow"><ArrowUpRight size={18}/></span></span>
            </button>
          </div>;
        })}
      </div>
      <footer className="news-drawer-foot"><span>Всё новое — в одном месте.</span><span>КЛИО<span className="news-foot-dot">●</span></span></footer>
    </section>
    {selected && <section ref={reader} id="workspace-news-article" className="workspace-news-reader" aria-labelledby="workspace-news-article-title">
      <header className="news-reader-head"><span>КЛИО / НОВОСТИ</span><button type="button" className="news-icon-button" aria-label="Вернуться к списку новостей" onClick={() => setSelectedId(null)}><X size={19}/></button></header>
      <article className="news-reader-article"><time dateTime={selected.createdAt}>{date(selected.createdAt)}</time><h2 id="workspace-news-article-title">{parts(selected.message).title}</h2>{parts(selected.message).body && <div className="news-reader-body">{parts(selected.message).body}</div>}</article>
      <footer className="news-reader-foot"><button type="button" disabled={index <= 0} onClick={() => setSelectedId(items[index - 1].id)}><ArrowLeft size={16}/>Предыдущая</button><span>{index + 1} / {items.length}</span><button type="button" disabled={index >= items.length - 1} onClick={() => setSelectedId(items[index + 1].id)}>Следующая<ArrowRight size={16}/></button></footer>
    </section>}
  </dialog>, document.body);
}
