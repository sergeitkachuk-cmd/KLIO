"use client";

import { useState, type ReactNode } from "react";

// Splits the admin page into a sidebar + one-section-at-a-time layout,
// same idea as the workspace module nav (app/textora-experience.tsx) -
// every section's content is server-rendered up front and just hidden via
// display:none while inactive, so nothing here re-fetches on tab switch
// and state inside a section (e.g. AdminUsersTable's own search box)
// survives switching away and back. Added because the flat single-page
// layout put every table on screen at once - "Пользователи" and
// "Последние вызовы ИИ" alone ran to hundreds of rows, so finding
// anything meant scrolling past everything else first.
export type AdminSection = { id: string; label: string; badge?: string; content: ReactNode };

export function AdminShell({ sections }: { sections: AdminSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <nav aria-label="Разделы админки">
          {sections.map((section) => (
            <button type="button" key={section.id} className={section.id === active ? "active" : ""} onClick={() => setActive(section.id)}>
              <span>{section.label}</span>
              {section.badge !== undefined && <em>{section.badge}</em>}
            </button>
          ))}
        </nav>
      </aside>
      <div className="admin-main">
        {sections.map((section) => (
          <div key={section.id} style={{ display: section.id === active ? undefined : "none" }}>
            {section.content}
          </div>
        ))}
      </div>
    </div>
  );
}
