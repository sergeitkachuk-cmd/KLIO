"use client";

import { Fragment, useMemo, useState } from "react";

export type AdminUserRow = {
  email: string; displayName: string; emailStatus: string; createdAt: string; planName: string; planExpires: string;
  planExpiryState: "soon" | "critical" | "expired" | "missing" | "normal"; generations: string; research: string; editor: string;
  brandCount: number; totalCost: string; lastCallAt: string; invoiceRefs: string; transactionRefs: string; payerNames: string;
};
type Props = { users: AdminUserRow[] };
const listValue = (value: string) => value.trim() || "—";

export function AdminUsersTable({ users }: Props) {
  const [query, setQuery] = useState("");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
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
        <thead><tr><th>Email</th><th>Имя</th><th>Тариф</th><th>Действует до</th><th>Генерации</th><th>Семантика</th><th>Редактор</th><th>Брендов</th><th>Расход</th><th>Детали</th></tr></thead>
        <tbody>
          {filteredUsers.map((item) => { const expanded = expandedEmail === item.email; return <Fragment key={item.email}>
            <tr><td>{item.email}</td><td><span>{item.displayName}</span><small className="admin-user-muted">{item.emailStatus} · {item.createdAt}</small></td><td>{item.planName}</td>
              <td className={`admin-plan-expiry admin-plan-expiry-${item.planExpiryState}`}>{item.planExpires}</td><td>{item.generations}</td><td>{item.research}</td><td>{item.editor}</td><td>{item.brandCount}</td><td>{item.totalCost}</td>
              <td><button type="button" className="admin-details-toggle" onClick={() => setExpandedEmail(expanded ? null : item.email)}>{expanded ? "Свернуть" : "Подробнее"}</button></td></tr>
            {expanded && <tr className="admin-user-details-row"><td colSpan={10}><div className="admin-user-details"><div><b>Почта:</b> {item.emailStatus}</div><div><b>Регистрация:</b> {item.createdAt}</div><div><b>Счета:</b> {listValue(item.invoiceRefs)}</div><div><b>Операции:</b> {listValue(item.transactionRefs)}</div><div><b>Плательщик:</b> {listValue(item.payerNames)}</div><div><b>Последний вызов ИИ:</b> {item.lastCallAt}</div></div></td></tr>}
          </Fragment>; })}
          {!filteredUsers.length && <tr><td colSpan={10} className="admin-empty-row">По этому запросу клиентов не найдено.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
