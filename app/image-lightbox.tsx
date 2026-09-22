"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

// A generated image's thumbnail (chat card, generator result panel) is
// necessarily small enough to sit next to other content, which made fine
// detail unreadable (site owner: "надо сделать ещё превью картинки после
// генерации, а то мелкие и не разглядеть ничего в них"). Click opens the
// same image at (near-)full size in an overlay; portaled to escape
// whatever clipping/stacking context the thumbnail lives in, same reason
// as this app's other portaled overlays.
export function ImageLightbox({ src, alt, onClose, actions }: { src: string; alt: string; onClose: () => void; actions?: ReactNode }) {
  const downTarget = useRef<EventTarget | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    // The opener may be inside ChatKit's iframe: move focus into this document
    // so Escape closes the preview instead of reaching the embedded composer.
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const controls = overlay.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  // Same deferred-close pattern as this app's other backdrop overlays: a
  // mousedown that starts on the backdrop but drags/releases elsewhere
  // (e.g. text selection) must not close it, and a click that only
  // bubbled up from the image itself must not either.
  function handleBackdropDown(event: ReactMouseEvent<HTMLDivElement>) {
    downTarget.current = event.target === event.currentTarget ? event.currentTarget : null;
  }
  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    const matched = downTarget.current === event.currentTarget && event.target === event.currentTarget;
    downTarget.current = null;
    if (matched) onClose();
  }

  return createPortal(
    <div
      ref={overlay}
      className={`image-lightbox-overlay${actions ? " image-lightbox-with-actions" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onMouseDown={handleBackdropDown}
      onClick={handleBackdropClick}
    >
      <button ref={closeButton} type="button" className="image-lightbox-close" aria-label="Закрыть превью" onClick={onClose}>
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- full-size
          preview of an already-loaded, already-optimized thumbnail's own
          source; next/image needs known dimensions this doesn't have. */}
      <img className="image-lightbox-image" src={src} alt={alt} />
      {actions && <div className="image-lightbox-actions">{actions}</div>}
    </div>,
    document.body,
  );
}
