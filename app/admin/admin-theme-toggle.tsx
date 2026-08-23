"use client";

import { useEffect, useState } from "react";

export function AdminThemeToggle() {
  const [dark, setDark] = useState(() => typeof window === "undefined" || window.localStorage.getItem("klio-admin-theme") !== "light");
  useEffect(() => { document.body.dataset.adminTheme = dark ? "dark" : "light"; }, [dark]);
  function toggle() {
    const nextDark = !dark;
    setDark(nextDark);
    document.body.dataset.adminTheme = nextDark ? "dark" : "light";
    window.localStorage.setItem("klio-admin-theme", nextDark ? "dark" : "light");
  }
  return <button type="button" className="admin-theme-toggle" onClick={toggle}>{dark ? "Светлая тема" : "Тёмная тема"}</button>;
}
