"use client";

import { useEffect, type RefObject } from "react";

/** Resolve anchors in scene coordinates; sticky panels cannot use native anchor offsets. */
export function useLandingNavigation(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    let frame = 0;
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function navigate(hash: string, smooth: boolean) {
      const target = document.getElementById(hash.slice(1));
      if (!target || !page?.contains(target)) return;
      page.querySelectorAll<HTMLElement>(".kl-scene-panel").forEach(panel => panel.style.removeProperty("--scene-anchor-top"));
      if (hash === "#top") {
        window.scrollTo({ top: 0, behavior: smooth && !reduced.matches ? "smooth" : "instant" });
        return;
      }
      const panel = target.closest<HTMLElement>(".kl-scene-panel");
      const stage = panel?.parentElement;
      const marker = target.querySelector<HTMLElement>(".kl-label") || target;
      const nav = page.querySelector<HTMLElement>(".kl-nav");
      // All section links are below the hero, where the header has its compact position.
      const navTop = innerWidth <= 700 ? 60 : 18;
      const readingTop = navTop + (nav?.offsetHeight || 64) + 24;
      let destination: number;
      if (panel && stage) {
        const localTop = marker.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        const stageTop = stage.getBoundingClientRect().top + scrollY;
        // A late section in a tall scene needs enough travel to reach the reading line.
        // Keep this stop while reading; clearing it immediately would jump the panel back.
        if (getComputedStyle(panel).position === "sticky") {
          const defaultTop = Math.min(0, innerHeight - panel.offsetHeight);
          panel.style.setProperty("--scene-anchor-top", `${Math.min(defaultTop, readingTop - localTop)}px`);
        }
        destination = stageTop + localTop - readingTop;
      } else destination = marker.getBoundingClientRect().top + scrollY - readingTop;
      window.scrollTo({ top: Math.max(0, destination), behavior: smooth && !reduced.matches ? "smooth" : "instant" });
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      const hash = link?.getAttribute("href");
      if (!hash || hash === "#" || !document.getElementById(hash.slice(1))) return;
      event.preventDefault();
      if (location.hash !== hash) history.pushState(null, "", hash);
      navigate(hash, true);
    };
    const restore = () => { if (location.hash) navigate(location.hash, false); else navigate("#top", false); };
    page.addEventListener("click", click);
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    // The browser/Next may restore the native fragment after hydration. Apply our
    // scene coordinates after that restoration and the initial font/layout pass.
    const settleInitial = () => {
      clearTimeout(initialTimer);
      initialTimer = setTimeout(() => {
        if (disposed || !location.hash) return;
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(restore); });
      }, 200);
    };
    const cancelInitial = () => { clearTimeout(initialTimer); cancelAnimationFrame(frame); };
    window.addEventListener("load", settleInitial);
    window.addEventListener("wheel", cancelInitial, { passive: true });
    window.addEventListener("touchstart", cancelInitial, { passive: true });
    // Font metrics and scene heights must settle before resolving a direct URL hash.
    void document.fonts.ready.then(() => {
      if (disposed || !location.hash) return;
      settleInitial();
    });
    return () => {
      disposed = true; clearTimeout(initialTimer); cancelAnimationFrame(frame);
      window.removeEventListener("load", settleInitial);
      window.removeEventListener("wheel", cancelInitial);
      window.removeEventListener("touchstart", cancelInitial);
      page.removeEventListener("click", click);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
      page.querySelectorAll<HTMLElement>(".kl-scene-panel").forEach(panel => panel.style.removeProperty("--scene-anchor-top"));
    };
  }, [root]);
}
