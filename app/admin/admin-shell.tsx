"use client";

import { useEffect, useState, type ReactNode } from "react";

// Splits the admin page into a sidebar + one-section-at-a-time layout,
// same idea as the workspace module nav (app/textora-experience.tsx) -
// every section's content is server-rendered up front and just hidden via
// display:none while inactive, so nothing here re-fetches on tab switch
// and state inside a section (e.g. AdminUsersTable's own search box)
// survives switching away and back. Added because the flat single-page
// layout put every table on screen at once - "Пользователи" and
// "Последние вызовы ИИ" alone ran to hundreds of rows, so finding
// anything meant scrolling past everything else first.
// attention: true paints the badge as something needing a look (currently
// only "Обращения" with at least one reply-less row - see feedbackUnreadCount
// in page.tsx), distinct from badge's own plain count-so-far meaning.
export type AdminSection = { id: string; label: string; badge?: string; attention?: boolean; content: ReactNode };

export function AdminShell({ sections }: { sections: AdminSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const applyHashSection = () => {
      const requested = window.location.hash.slice(1);
      if (requested && sections.some((section) => section.id === requested)) setActive(requested);
    };
    applyHashSection();
    window.addEventListener("hashchange", applyHashSection);
    return () => window.removeEventListener("hashchange", applyHashSection);
  }, [sections]);
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <nav aria-label="Разделы админки">
          {sections.map((section) => (
            <button type="button" key={section.id} className={section.id === active ? "active" : ""} onClick={() => {
              setActive(section.id);
              window.history.replaceState(null, "", `#${section.id}`);
              // Sections vary wildly in height ("Пользователи"/"Расход на
              // ИИ" run to hundreds of rows, others are a few lines) - with
              // no scroll reset, switching away from deep inside a tall one
              // to a much shorter one left the visitor stranded scrolled
              // past its end, looking at blank space with only the fixed
              // mobile nav bar in view (site owner: "кнопки меню улетают
              // вниз за экран" - not the nav moving, the content underneath
              // it disappearing).
              window.scrollTo(0, 0);
            }}>
              <span>{section.label}</span>
              {section.badge !== undefined && <em className={section.attention ? "admin-badge-attention" : undefined}>{section.badge}</em>}
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
