"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
export function BrandCreateDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return createPortal(<dialog ref={ref} className="brand-create-dialog" aria-labelledby="brand-create-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="brand-create-title">Новый бренд</h2><button type="button" aria-label="Закрыть создание бренда" onClick={onClose}><X size={20}/></button></header>
    <p>Создайте отдельное пространство для профиля и материалов бренда.</p>
    <label htmlFor="new-workspace-brand">Название бренда</label>{children}
  </dialog>, document.body);
}
