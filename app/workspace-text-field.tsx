"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentPropsWithRef } from "react";
import { flushSync } from "react-dom";

export const BufferedWorkspaceInput = createContext(false);
type Field = HTMLInputElement | HTMLTextAreaElement;

// Keep typing in the leaf component. Expensive workspace previews and persistence
// receive a snapshot after a pause, or synchronously before the next user action.
function useFieldDraft<T extends Field>(value: ComponentPropsWithRef<"input">["value"], onChange: ((event: ChangeEvent<T>) => void) | undefined, enabled: boolean) {
  const [draft, setDraft] = useState({ source: value, value });
  if (draft.source !== value) setDraft({ source: value, value });
  const pending = useRef<ChangeEvent<T> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onChange);
  useLayoutEffect(() => { callback.current = onChange; }, [onChange]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const event = pending.current;
    pending.current = null;
    if (event) callback.current?.(event);
  }, []);

  useLayoutEffect(() => {
    // Only a changed upstream value can replace a draft. Unrelated workspace
    // updates must never erase characters that haven't been committed yet.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, [value]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const beforeAction = (event: Event) => {
      const field = pending.current?.target;
      if (!field) return;
      if (event.type === "pointerdown" && field === event.target) return;
      if (event instanceof KeyboardEvent && event.key !== "Enter") return;
      flushSync(() => flush());
    };
    document.addEventListener("pointerdown", beforeAction, true);
    document.addEventListener("keydown", beforeAction, true);
    document.addEventListener("submit", beforeAction, true);
    window.addEventListener("pagehide", beforeAction);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("pointerdown", beforeAction, true);
      document.removeEventListener("keydown", beforeAction, true);
      document.removeEventListener("submit", beforeAction, true);
      window.removeEventListener("pagehide", beforeAction);
    };
  }, [enabled, flush]);

  return {
    value: enabled ? draft.value : value,
    onChange(event: ChangeEvent<T>) {
      if (!enabled) { onChange?.(event); return; }
      setDraft({ source: value, value: event.target.value });
      // React clears currentTarget after dispatch; retain the real field for
      // the existing form handlers, including formatting and validation.
      pending.current = { ...event, target: event.target, currentTarget: event.currentTarget };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), 250);
    },
    commit() { if (pending.current) flushSync(() => flush()); },
  };
}

export function WorkspaceTextarea({ value, onChange, onBlur, ...props }: ComponentPropsWithRef<"textarea">) {
  const enabled = useContext(BufferedWorkspaceInput) && value !== undefined && Boolean(onChange);
  const field = useFieldDraft<HTMLTextAreaElement>(value, onChange, enabled);
  return <textarea {...props} value={field.value} onChange={field.onChange} onBlur={event => { field.commit(); onBlur?.(event); }} />;
}

export function WorkspaceInput({ value, onChange, onBlur, ...props }: ComponentPropsWithRef<"input">) {
  const buffer = useContext(BufferedWorkspaceInput);
  const enabled = buffer && value !== undefined && Boolean(onChange) && [undefined, "text", "url", "email", "tel", "password", "search"].includes(props.type);
  const field = useFieldDraft<HTMLInputElement>(value, onChange, enabled);
  return <input {...props} value={field.value} onChange={field.onChange} onBlur={event => { field.commit(); onBlur?.(event); }} />;
}
