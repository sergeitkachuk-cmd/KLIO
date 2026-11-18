"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, Check, ChevronDown, Menu, X, FileText, ImageIcon, CalendarDays, AudioLines, Layers, Send } from "lucide-react";
import { BILLING_PERIODS, periodAmount, type BillingPeriod } from "./billing-pricing";
import { landingFaq, landingPricing, BILLING_TOGGLE_LABELS } from "./landing-content";
import "./cinematic-home.css";
import { MotionHeading, useLandingMotion } from "./landing-motion";
import { useLandingNavigation } from "./landing-navigation";
import { ScrollScene } from "./landing-scroll-scene";
import { LandingCircuit } from "./landing-circuit";
import { LandingGlobe } from "./landing-globe";
import { LandingMaterialExamples } from "./landing-material-examples";
import "./landing-motion.css";
import "./landing-scenes.css";
import "./landing-typography.css";

const tools = [
  { icon: FileText, title: "Слова, которые работают", text: "Статьи для поиска, посты для соцсетей, реклама и тексты для сайта. С голосом вашего бренда и пониманием задачи читателя.", href: "/workspace#generator", link: "Открыть редактор", className: "words" },
  { icon: ImageIcon, title: "Идеи, которые видно", text: "Создавайте изображения, дорабатывайте готовые визуалы и собирайте карусели. Одна история — в тексте и в кадре.", href: "/workspace#images", link: "Создать изображение", className: "visuals" },
  { icon: CalendarDays, title: "Контент, который выходит", text: "Собирайте темы в план, сохраняйте материалы и назначайте публикации. Вся редакционная работа — в одном пространстве.", href: "/workspace#publications", link: "Открыть календарь", className: "calendar" },
];
const demos = [
  { label: "Текст", icon: FileText, eyebrow: "Пост для социальных сетей", title: "Истории начинаются с маленьких деталей", body: "Первый глоток кофе. Свет из окна. Пара слов, сказанных с заботой. Именно из таких моментов складывается характер места, в которое хочется возвращаться.", note: "Живой, внимательный, уверенный", href: "/workspace#generator", cta: "Создать свой текст" },
  { label: "Изображения", icon: ImageIcon, eyebrow: "Визуальная история", title: "Посмотреть на привычное иначе", body: "Мягкий утренний свет, тёплая палитра и простая композиция. Образ, который продолжает вашу историю и помогает ей запомниться.", note: "Текст, визуал и карусель — в одном стиле", href: "/workspace#images", cta: "Создать изображение" },
  { label: "Контент-план", icon: Layers, eyebrow: "От темы до материала", title: "У каждой идеи — своё продолжение", body: "01 / Как найти свой вкус\n02 / История человека за стойкой\n03 / Что меняется в одном зерне\n04 / Маленькие ритуалы большого дня", note: "Тема, поисковый запрос, структура и цель", href: "/workspace#content-plan", cta: "Собрать контент-план" },
  { label: "Публикации", icon: CalendarDays, eyebrow: "Редакционный календарь", title: "В нужное время. В нужном месте.", body: "Понедельник / История бренда\nСреда / Полезный совет\nПятница / Новая коллекция\nВоскресенье / Разговор с аудиторией", note: "Отложенные публикации в Telegram и VK", href: "/workspace#publications", cta: "Открыть публикации" },
];
function Mark({ small = false }: { small?: boolean }) { return <span className={`kl-mark${small ? " kl-mark-small" : ""}`} aria-hidden="true">{Array.from({length:8},(_,i)=><i key={i} style={{rotate:`${i*45}deg`}}/>)}</span>; }
function Label({ children }: { children: React.ReactNode }) { return <span className="kl-label"><i/>{children}</span>; }

export default function CinematicHome() {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const html = document.documentElement;
    let preferredTheme = html.dataset.theme || "dark";
    try { preferredTheme = localStorage.getItem("klio-theme") || preferredTheme; } catch {}
    html.dataset.theme = "dark";
    return () => { html.dataset.theme = preferredTheme === "light" ? "light" : "dark"; };
  }, []);
  useLandingMotion(root);
  useLandingNavigation(root);
  const [menuOpen, setMenuOpen] = useState(false);
  const [demo, setDemo] = useState(0);
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const activeDemo = demos[demo];
  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); observer.unobserve(entry.target); }
    }), { threshold: .12 });
    element.querySelectorAll<HTMLElement>("[data-reveal]").forEach(node => {
      if (node.getBoundingClientRect().top > innerHeight) node.classList.add("kl-waiting");
      observer.observe(node);
    });
    const story = element.querySelector<HTMLElement>(".kl-story");
    const hero = element.querySelector<HTMLElement>(".kl-hero");
    const globe = element.querySelector<HTMLElement>(".kl-orbit-section");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (story) { const r = story.getBoundingClientRect(); const progress = Math.max(0, Math.min(1, -r.top / Math.max(1,r.height-innerHeight))); story.style.setProperty("--story-progress",String(progress)); }
      if (hero) hero.style.setProperty("--hero-scroll",String(Math.max(0, Math.min(1, -hero.getBoundingClientRect().top/innerHeight))));
      if (globe) { const r=globe.getBoundingClientRect(); if(r.top<innerHeight&&r.bottom>0) globe.style.setProperty("--orbit-turn",`${(innerHeight-r.top)*.025}deg`); }
    };
    const schedule = () => { if (!frame) frame=requestAnimationFrame(update); };
    window.addEventListener("scroll",schedule,{passive:true}); window.addEventListener("resize",schedule); update();
    return () => { observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule); };
  }, []);
  return <main ref={root} className="cinematic-home" id="top">
    <div className="kl-opening" aria-hidden="true"><Mark/><span>КЛИО / ВАША ЦИФРОВАЯ РЕДАКЦИЯ</span></div>
    <div className="kl-announcement"><span>КЛИО — цифровая редакция для вашего бренда</span><div className="kl-header-tools">
      <a href="https://t.me/kliopress" target="_blank" rel="noreferrer"><Send size={17}/>Telegram КЛИО</a>
      <Link href="/login">Войти <ArrowUpRight size={17}/></Link>
    </div></div>
    <header className="kl-nav">
      <Link className="kl-logo" href="#top" aria-label="КЛИО — на главную"><Mark small/><span>КЛИО<b>.</b></span></Link>
      <nav aria-label="Главное меню" className={menuOpen ? "is-open" : ""}>
        {[["Возможности","#features"],["Как работает","#workflow"],["Для кого","#audience"],["Тарифы","#pricing"],["Вопросы","#faq"]].map(([text,href])=><a key={href} href={href} onClick={()=>setMenuOpen(false)}>{text}</a>)}
      </nav>
      <button className="kl-menu-toggle" type="button" onClick={()=>setMenuOpen(!menuOpen)} aria-label={menuOpen?"Закрыть меню":"Открыть меню"} aria-expanded={menuOpen}>{menuOpen?<X size={19}/>:<Menu size={19}/>}</button>
    </header>

    <ScrollScene order={0}><div className="kl-hero-track"><section className="kl-hero kl-section">
      <div className="kl-beam" aria-hidden="true"/>
      <div className="kl-hero-copy"><Label>Смысл. Стиль. Результат.</Label>
        <MotionHeading hero lines={["Ваша идея.","Большая история."]}/>
        <p>Тексты, изображения и публикации, в которых узнают ваш бренд.<br className="kl-desktop-break"/> От первого замысла до готового материала — вместе с КЛИО.</p>
        <div className="kl-actions"><Link className="kl-button kl-button-gold" href="/login?return_to=%2Fworkspace">Открыть свою редакцию <ArrowUpRight size={17}/></Link><a className="kl-text-link" href="#workflow">Как это работает <ArrowRight size={15}/></a></div>
      </div>
      <LandingCircuit/>
      <a className="kl-scroll-hint" href="#workflow">Листайте, история продолжается <ChevronDown size={14}/></a>
    </section></div></ScrollScene>

    <ScrollScene order={1}><section className="kl-story" id="workflow">
      <div className="kl-story-sticky"><div className="kl-story-curtain" aria-hidden="true"/>
        <div className="kl-story-content"><Label>01 / Сначала — понимание</Label><MotionHeading lines={["Не просто больше контента.","Больше вашего характера."]}/>
          <div className="kl-brand-scene">
            <div className="kl-brand-visual" aria-hidden="true"><div className="kl-brand-orbit"/><Mark/><div className="kl-brand-floating kl-brand-floating-one">Ваш голос <AudioLines size={16}/></div><div className="kl-brand-floating kl-brand-floating-two">Ваша аудитория <Layers size={16}/></div><div className="kl-brand-visual-caption">КЛИО / ПРОФИЛЬ БРЕНДА<strong>Всё начинается<br/>с вашего характера.</strong></div></div>
            <div className="kl-brand-description"><h3>Ваш бренд — отправная точка.<br/>Для каждой новой истории.</h3><p>КЛИО собирает знания о компании, аудитории и голосе бренда. Чтобы каждый следующий материал продолжал вашу историю.</p><Link className="kl-button" href="/workspace#brand-profile">Начать с профиля бренда <ArrowUpRight size={17}/></Link><div className="kl-brand-formats">{["Смыслы","Аудитория","Тон общения","Ваши правила","Стиль","Факты"].map(t=><span key={t}>{t}</span>)}</div></div>
          </div>
        </div>
      </div>
    </section>

    </ScrollScene><ScrollScene order={2}><section className="kl-section kl-features" id="features">
      <div className="kl-heading" data-reveal><Label>02 / Одна редакция</Label><MotionHeading lines={["Всё, что нужно идее,","чтобы стать заметной."]}/><p>От смысла и структуры до визуала и публикации.<br/>Инструменты работают вместе, а вы держите историю в своих руках.</p></div>
      <div className="kl-feature-grid">{tools.map((tool,i)=><article className={`kl-feature kl-feature-${tool.className}`} key={tool.title} data-reveal style={{"--reveal-delay":`${i*70}ms`} as React.CSSProperties}>
        <div className="kl-feature-art" aria-hidden="true">{i===0?<div className="kl-paper-stack"><i/><i/><div><span>КЛИО / МАТЕРИАЛ</span><b>Слова,<br/>которые<br/>помнят.</b><span>С голосом вашего бренда ↗</span></div></div>:i===1?<div className="kl-visual-art"><div/><span>ИЗ ИДЕИ В ОБРАЗ</span><Mark/></div>:<div className="kl-calendar-art"><span>ВАШ ПЛАН НА НЕДЕЛЮ</span><div>{["ПН","ВТ","СР","ЧТ","ПТ"].map((d,n)=><i className={n===2?"active":""} key={d}><small>{d}</small><b>{16+n}</b>{n%2===0&&<em/>}</i>)}</div><p><i/> История бренда <span>11:00 ↗</span></p></div>}</div>
        <div className="kl-feature-copy"><tool.icon size={20}/><h3>{tool.title}</h3><p>{tool.text}</p><Link href={tool.href}>{tool.link}<ArrowUpRight size={16}/></Link></div>
      </article>)}</div>
    </section>

    </ScrollScene><ScrollScene order={3} dwell><div className="kl-orbit-track"><section className="kl-section kl-orbit-section">
      <div className="kl-heading" data-reveal><Label>03 / Больше связей. Меньше рутины.</Label><MotionHeading lines={["Один голос.","На всех ваших площадках."]}/><p>Пост, статья, реклама или карусель — адаптируйте историю<br/>под формат, сохраняя то, что делает бренд вашим.</p></div>
      <div className="kl-orbit" aria-hidden="true"><LandingGlobe/><div className="kl-orbit-ring"/><span className="kl-orbit-tag kl-orbit-tag-1">SEO-статьи</span><span className="kl-orbit-tag kl-orbit-tag-2">Telegram</span><span className="kl-orbit-tag kl-orbit-tag-3">VK</span><span className="kl-orbit-tag kl-orbit-tag-4">Карусели</span><div className="kl-orbit-center"><Mark/></div></div>
    </section></div>

    </ScrollScene><ScrollScene order={4}><div className="kl-light-world">
      <section className="kl-section kl-demo-section" id="demo">
        <div className="kl-heading" data-reveal><Label>04 / Результат в деталях</Label><MotionHeading lines={["От первого «а что если»","до «можно публиковать»."]}/><p>Посмотрите на готовые тексты, изображения, темы и публикации.</p></div>
        <div className="kl-demo-tabs" role="tablist" aria-label="Форматы материала">{demos.map((item,i)=><button key={item.label} type="button" role="tab" id={`demo-tab-${i}`} aria-controls="demo-panel" aria-selected={demo===i} onClick={()=>setDemo(i)}><item.icon size={16}/>{item.label}</button>)}</div>
        <div className="kl-example-panel" role="tabpanel" id="demo-panel" aria-labelledby={`demo-tab-${demo}`}>
          <LandingMaterialExamples key={demo} format={demo}/>
        </div>
        <div className="kl-example-caption"><span>{activeDemo.note}</span><Link href={activeDemo.href}>{activeDemo.cta}<ArrowUpRight size={18}/></Link></div>
      </section>
      <section className="kl-section kl-audience" id="audience"><div className="kl-heading" data-reveal><Label>Ваша задача. Ваш масштаб.</Label><MotionHeading lines={["Для тех, кому","есть что рассказать."]}/></div><div className="kl-audience-grid">{[["01","Экспертам","Превращайте опыт в статьи и посты, которые помогают аудитории понять вашу ценность.","От мысли — к точной формулировке"],["02","Бизнесу","Рассказывайте о продукте, отвечайте на вопросы клиентов и поддерживайте регулярное присутствие.","От продукта — к его истории"],["03","Маркетологам","Собирайте план на основе темы, поискового спроса и анализа конкурентов. Готовьте материалы для разных каналов.","От стратегии — к публикациям"],["04","Агентствам","Ведите несколько брендов в отдельных пространствах: со своим голосом, материалами и планами.","От одного бренда — к целой редакции"]].map(([n,title,body,note])=><article data-reveal key={n}><span>{n}</span><h3>{title}</h3><p>{body}</p><small>{note}<ArrowUpRight size={16}/></small></article>)}</div></section>
    </div>

    </ScrollScene><ScrollScene order={5} last><section className="kl-section kl-pricing" id="pricing"><div className="kl-heading" data-reveal><Label>Редакция по вашему масштабу</Label><MotionHeading lines={["Начните с идеи.","Выберите свой ритм."]}/><p>72 часа бесплатно для нового аккаунта.<br/>Платный тариф можно выбрать позже в личном кабинете.</p></div>
      <div className="kl-billing" role="group" aria-label="Период оплаты">{BILLING_PERIODS.map(period=><button key={period.id} type="button" aria-pressed={billing===period.id} onClick={()=>setBilling(period.id)}>{BILLING_TOGGLE_LABELS[period.id]}{period.discount>0&&<small>−{period.discount}%</small>}</button>)}</div>
      <div className="kl-price-grid">{landingPricing.map(plan=>{const period=BILLING_PERIODS.find(p=>p.id===billing)!;const total=periodAmount(plan.monthly,plan.yearly,billing);return <article className={plan.popular?"kl-price-featured":""} key={plan.name} data-reveal>{plan.popular&&<span className="kl-price-badge">Полный доступ</span>}<span className="kl-price-index">КЛИО / {plan.name}</span><h3>{plan.name}</h3><p>{plan.description}</p><div className="kl-price"><b>{Math.round(total/period.months).toLocaleString("ru-RU")} ₽</b><span>/ месяц</span></div><small>{billing==="monthly"?"Оплата помесячно":`${total.toLocaleString("ru-RU")} ₽ за ${period.label}`}</small><p className="kl-price-limit">{plan.limit}</p><ul>{plan.features.map(feature=><li key={feature}><Check size={14}/>{feature}</li>)}</ul><Link className="kl-button" href="/login?return_to=%2Fworkspace">Попробовать бесплатно<ArrowUpRight size={16}/></Link></article>;})}</div><p className="kl-payment-note">Оплата российскими картами и по СБП · документы для юридических лиц</p>
    </section>
    <section className="kl-section kl-faq" id="faq"><div className="kl-heading" data-reveal><Label>Перед первым материалом</Label><MotionHeading lines={["Осталось","пару вопросов?"]}/></div><div className="kl-faq-list">{landingFaq.map((item,i)=><details key={item.question} open={faqOpen===i} onToggle={event=>{if(event.currentTarget.open&&faqOpen!==i)setFaqOpen(i);}}><summary onClick={event=>{event.preventDefault();setFaqOpen(faqOpen===i?null:i);}}><span>{String(i+1).padStart(2,"0")}</span><b>{item.question}</b><ChevronDown size={18}/></summary><p>{item.answer}</p></details>)}</div></section>
    <section className="kl-closing"><div data-reveal><Label>Следующая история — ваша</Label><MotionHeading lines={["Дайте идее","стать чем-то большим."]}/><p>Откройте свою цифровую редакцию.<br/>И начните с того, о чём давно хотели рассказать.</p><Link className="kl-button kl-button-gold" href="/login?return_to=%2Fworkspace">Создать первый материал<ArrowUpRight size={17}/></Link></div><div className="kl-horizon" aria-hidden="true"/></section>
    <footer className="kl-footer"><div><Link className="kl-logo" href="#top"><Mark small/><span>КЛИО<b>.</b></span></Link><p>Смысл. Стиль. Результат.</p></div><nav aria-label="Ссылки в подвале"><Link href="/login">Войти</Link><Link href="/examples">Примеры материалов</Link><a href="https://t.me/kliopress" target="_blank" rel="noreferrer">Telegram КЛИО<ArrowUpRight size={12}/></a></nav><div className="kl-footer-bottom"><small>© {new Date().getFullYear()} КЛИО — цифровая редакция</small><nav aria-label="Правовая информация"><Link href="/legal/offer">Оферта</Link><Link href="/legal/privacy">Политика обработки данных</Link><Link href="/legal/refunds">Возвраты</Link></nav></div></footer>
  </ScrollScene></main>;
}
