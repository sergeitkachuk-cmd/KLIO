"use client";

import { startTransition, useState } from "react";

/** Update the thumb immediately, independently of derived workspace data. */
export function WorkspaceBrandContext({ checked, status, onChange, onOpen }: {
  checked: boolean;
  status: string;
  onChange: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const [state, setState] = useState({ source: checked, value: checked });
  if (state.source !== checked) setState({ source: checked, value: checked });
  return <div className={`workspace-brand-pill ${state.value ? "is-on" : "is-off"}`}>
    <button type="button" className="workspace-brand-pill-info" onClick={onOpen} title={status}>
      <span><b>Профиль бренда</b><small>{status}</small></span>
    </button>
    <label className="brand-switch workspace-brand-pill-switch" title={state.value ? "Отключить профиль бренда" : "Включить профиль бренда"}>
      <input type="checkbox" aria-label="Учитывать профиль бренда" checked={state.value} onChange={event => {
        const next = event.target.checked;
        setState({ source: checked, value: next });
        startTransition(() => onChange(next));
      }}/>
      <span/>
    </label>
  </div>;
}
