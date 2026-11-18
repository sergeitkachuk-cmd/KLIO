"use client";

import type { ComponentPropsWithRef } from "react";
import "./site-toggle.css";

/** Shared pill switch; the native input retains labels, keyboard and form behavior. */
export function SiteToggle({ role = "switch", className = "", ...props }: Omit<ComponentPropsWithRef<"input">, "type">) {
  return <span className="site-toggle">
    <input {...props} type="checkbox" role={role} className={`site-toggle-input ${className}`}/>
    <span className="site-toggle-track" aria-hidden="true"/>
  </span>;
}
