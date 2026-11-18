"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import "./login/login-design.css";

function Star({ className }: {className:string}) {
  return <div className={className} aria-hidden="true">{Array.from({length:8},(_,i)=><i key={i} style={{rotate:`${i*45}deg`}}/>)}</div>;
}

export function AuthEditorial({ children, signup=false, returnTo="/workspace" }: {children:ReactNode;signup?:boolean;returnTo?:string}) {
  return <main className={`auth-shell login-editorial auth-animated${signup?" signup-editorial":""}`}>
    <div className="auth-entry-stage" aria-hidden="true"><Star className="login-star auth-entry-star"/></div>
    <section className="login-art" aria-label="КЛИО — цифровая редакция">
      <Link className="login-wordmark" href="/">КЛИО<span>.</span><small>Цифровая редакция</small></Link>
      <div className="login-art-grid" aria-hidden="true"/>
      <Star className="login-star"/>
      <div className="login-art-caption"><span>Место, где идеи<br/>становятся историями.</span><small>Смысл. Стиль. Результат.</small></div>
    </section>
    <div className="auth-card">
      <div className="login-card-top"><span>ВАША ЦИФРОВАЯ РЕДАКЦИЯ</span><Link href={{pathname:signup?"/login":"/signup",query:{return_to:returnTo}}}>{signup?"Уже есть аккаунт? Войти ↗":"Создать аккаунт ↗"}</Link></div>
      <div className="login-form-content">{children}</div>
      <footer className="login-card-foot"><span>Пространство для ваших историй.</span><Link href="/">На главную ↗</Link></footer>
    </div>
  </main>;
}
