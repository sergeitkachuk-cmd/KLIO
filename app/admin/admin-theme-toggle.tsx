"use client";

import { useEffect, useState } from "react";

export function AdminThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = window.localStorage.getItem("klio-admin-theme");
    const nextDark = saved !== "light";
    setDark(nextDark);
    document.body.dataset.adminTheme = nextDark ? "dark" : "light";
  }, []);
  function toggle() {
    const nextDark = !dark;
    setDark(nextDark);
    document.body.dataset.adminTheme = nextDark ? "dark" : "light";
    window.localStorage.setItem("klio-admin-theme", nextDark ? "dark" : "light");
  }
  return <button type="button" className="admin-theme-toggle" onClick={toggle}>{dark ? "Светлая тема" : "Тёмная тема"}</button>;
}
