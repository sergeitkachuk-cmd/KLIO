"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

export function DialogueRailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Развернуть боковое меню" : "Свернуть боковое меню";
  return <button className="klio-rail-toggle" type="button" aria-label={label} title={label} aria-expanded={!collapsed} onClick={onToggle}>
    {collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}
  </button>;
}
