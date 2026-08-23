"use client";

import { useMemo, useState } from "react";

export type AdminUserRow = {
  email: string;
  displayName: string;
  emailStatus: string;
  createdAt: string;
  planName: string;
  planExpires: string;
  planExpiryState: "soon" | "critical" | "expired" | "missing" | "normal";
  generations: string;
  research: string;
  editor: string;
  brandCount: number;
  totalCost: string;
  lastCallAt: string;
  invoiceRefs: string;
  transactionRefs: string;
  payerNames: string;
};

type Props = { users: AdminUserRow[] };

function listValue(value: string): string {
  return value.trim() || "—";
}

export function AdminUsersTable({ users }: Props) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;
    return users.filter((item) => [
      item.email,
      item.displayName,
      item.planName,
      item.invoiceRefs,
      item.transactionRefs,
      item.payerNames,
    ].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  }, [normalizedQuery, users]);

  return (
    <>
      <div className="admin-users-toolbar">
        <label htmlFor="admin-user-search">Поиск клиента</label>
        <input
          id="admin-user-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Email, имя, тариф, номер счёта или операции"
        />
        <span>{filteredUsers.length} из {users.length}</span>
      </div>
      <div className="admin-table-scroll">
        <table className="admin-table admin-table-users">
          <thead>
            <tr>
              <th>Email</th><th>Имя</th><th>Почта</th><th>Регистрация</th><th>Тариф</th><th>Действует до</th>
              <th>Счета</th><th>Операции</th><th>Плательщик</th><th>Генерации</th><th>Семантика</th><th>Редактор</th>
              <th>Брендов</th><th>Расход</th><th>Последний вызов ИИ</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((item) => (
              <tr key={item.email}>
                <td>{item.email}</td>
                <td>{item.displayName}</td>
                <td>{item.emailStatus}</td>
                <td>{item.createdAt}</td>
                <td>{item.planName}</td>
                <td className={`admin-plan-expiry admin-plan-expiry-${item.planExpiryState}`}>{item.planExpires}</td>
                <td>{listValue(item.invoiceRefs)}</td>
                <td>{listValue(item.transactionRefs)}</td>
                <td>{listValue(item.payerNames)}</td>
                <td>{item.generations}</td>
                <td>{item.research}</td>
                <td>{item.editor}</td>
                <td>{item.brandCount}</td>
                <td>{item.totalCost}</td>
                <td>{item.lastCallAt}</td>
              </tr>
            ))}
            {!filteredUsers.length && <tr><td colSpan={15} className="admin-empty-row">По этому запросу клиентов не найдено.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
