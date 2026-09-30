"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

export type AdminUserRow = {
  email: string; displayName: string; avatarUrl: string | null; emailStatus: string; createdAt: string; planName: string; planExpires: string;
  planExpiryState: "soon" | "critical" | "expired" | "missing" | "normal"; generations: string; research: string; editor: string; dialogue: string;
  brandCount: number; totalCost: string; lastCallAt: string; invoiceRefs: string; transactionRefs: string; payerNames: string;
  // Detailed usage breakdown (site owner: "чтобы это было не общее
  // обозначение") — null completion means the account has no brand at all,
  // distinct from 0% (a brand row exists but nothing in it is filled in).
  brandProfileCompletion: number | null;
  textsGenerated: number; textsEdited: number; textsManual: number; imagesGenerated: number;
  contentPlans: number; semanticsRuns: number; competitorAnalyses: number;
  publicationsCount: number; everPaid: boolean;
  signupMethod: string;
  socialChannelsVk: number; socialChannelsTelegram: number;
  registeredToday: boolean;
};
type Props = { users: AdminUserRow[] };
const listValue = (value: string) => value.trim() || "—";
// Same two-initial fallback as nameInitials() in textora-experience.tsx -
// duplicated rather than imported, this file has no existing pattern of
// pulling from that module (see the BrandProfile mirror comment there).
function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((item) => item[0]?.toLocaleUpperCase("ru-RU") || "").join("") || "К").slice(0, 2);
}

export function AdminUsersTable({ users }: Props) {
  const [query, setQuery] = useState("");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string; email: string } | null>(null);
  useEffect(() => {
    if (!avatarPreview) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAvatarPreview(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [avatarPreview]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;
    return users.filter((item) => [item.email, item.displayName, item.planName, item.invoiceRefs, item.transactionRefs, item.payerNames]
      .some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  }, [normalizedQuery, users]);

  return <>
    <div className="admin-users-toolbar">
      <label htmlFor="admin-user-search">Поиск клиента</label>
      <input id="admin-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, имя, тариф, номер счёта или операции" />
      <span>{filteredUsers.length} из {users.length}</span>
    </div>
    <div className="admin-table-scroll">
      <table className="admin-table admin-table-users">
        <thead><tr><th>Email</th><th>Имя</th><th>Тариф</th><th>Действует до</th><th>Генерации</th><th>Изображения</th><th>Семантика</th><th>Редактор</th><th>Диалог</th><th>Брендов</th><th>Расход</th><th>Детали</th></tr></thead>
        <tbody>
          {filteredUsers.map((item) => { const expanded = expandedEmail === item.email; return <Fragment key={item.email}>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external host (own /api/admin/account-avatar, or Yandex's/VK's own CDN) - not worth a next.config.ts remotePatterns entry for two different providers */}
            <tr className={item.registeredToday ? "admin-user-row-new" : undefined}><td>{item.email}</td><td><div className="admin-user-name-cell">{item.avatarUrl ? <button type="button" className="admin-avatar-circle admin-avatar-button" aria-label={`Открыть аватар ${item.displayName} крупнее`} title="Открыть аватар крупнее" onClick={() => setAvatarPreview({ url: item.avatarUrl!, name: item.displayName, email: item.email })}><img src={item.avatarUrl} alt="" /></button> : <span className="admin-avatar-circle">{initials(item.displayName)}</span>}<span><span>{item.displayName}</span><small className="admin-user-muted">{item.emailStatus} · {item.createdAt}</small></span></div></td><td>{item.planName}</td>
              <td className={`admin-plan-expiry admin-plan-expiry-${item.planExpiryState}`}>{item.planExpires}</td><td>{item.generations}</td><td>{item.imagesGenerated}</td><td>{item.research}</td><td>{item.editor}</td><td>{item.dialogue}</td><td>{item.brandCount}</td><td>{item.totalCost}</td>
              <td><button type="button" className="admin-details-toggle" onClick={() => setExpandedEmail(expanded ? null : item.email)}>{expanded ? "Свернуть" : "Подробнее"}</button></td></tr>
            {expanded && <tr className="admin-user-details-row"><td colSpan={12}><div className="admin-user-details">
              <div><b>Почта:</b> {item.emailStatus}</div><div><b>Регистрация:</b> {item.createdAt}</div><div><b>Последний вызов ИИ:</b> {item.lastCallAt}</div>
              <div><b>Профиль бренда заполнен:</b> {item.brandProfileCompletion === null ? "бренд не создан" : `${item.brandProfileCompletion}%`}</div>
              <div><b>Тексты (генератор):</b> {item.textsGenerated}</div>
              <div><b>Тексты (редактор):</b> {item.textsEdited}</div>
              <div><b>Тексты (вручную):</b> {item.textsManual}</div>
              <div><b>Контент-планы:</b> {item.contentPlans}</div>
              <div><b>Семантика:</b> {item.semanticsRuns}</div>
              <div><b>Анализ конкурентов:</b> {item.competitorAnalyses}</div>
              <div><b>Публикации:</b> {item.publicationsCount}</div>
              <div><b>Подключено соцсетей:</b> {item.socialChannelsVk + item.socialChannelsTelegram === 0 ? "нет" : `VK ${item.socialChannelsVk}, Telegram ${item.socialChannelsTelegram}`}</div>
              <div><b>Когда-либо оплачивал:</b> {item.everPaid ? "Да" : "Нет"}</div>
              <div><b>Способ регистрации:</b> {item.signupMethod}</div>
              <div className="admin-user-details-wide"><b>Счета:</b> {listValue(item.invoiceRefs)}</div><div className="admin-user-details-wide"><b>Операции:</b> {listValue(item.transactionRefs)}</div><div className="admin-user-details-wide"><b>Плательщик:</b> {listValue(item.payerNames)}</div></div></td></tr>}
          </Fragment>; })}
          {!filteredUsers.length && <tr><td colSpan={12} className="admin-empty-row">По этому запросу клиентов не найдено.</td></tr>}
        </tbody>
      </table>
    </div>
    {avatarPreview && <div className="admin-avatar-preview" role="dialog" aria-modal="true" aria-label={`Аватар ${avatarPreview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setAvatarPreview(null); }}>
      <div className="admin-avatar-preview-card">
        <button type="button" className="admin-avatar-preview-close" aria-label="Закрыть крупный аватар" onClick={() => setAvatarPreview(null)}>×</button>
        {/* eslint-disable-next-line @next/next/no-img-element -- same authenticated/external avatar URL as the table image above */}
        <img src={avatarPreview.url} alt={`Аватар ${avatarPreview.name}`} />
        <div><strong>{avatarPreview.name}</strong><small>{avatarPreview.email}</small></div>
      </div>
    </div>}
  </>;
}
