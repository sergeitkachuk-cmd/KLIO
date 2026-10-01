"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

const examples = [
  {
    id: "autocorrect",
    label: "Автокоррекция",
    title: "Свет, цвет и чёткость",
    description: "КЛИО выравнивает свет и цвет, аккуратно подчёркивает детали и сохраняет естественный вид человека.",
    before: "/landing/image-studio/autocorrect-before.webp",
    after: "/landing/image-studio/autocorrect-after.webp",
  },
  {
    id: "studio",
    label: "Студийный фон",
    title: "Новая подача исходного кадра",
    description: "Готовую фотографию можно доработать по описанию: например, заменить окружение на нейтральный студийный фон.",
    before: "/landing/image-studio/autocorrect-before.webp",
    after: "/landing/image-studio/studio-after.webp",
  },
  {
    id: "remove-object",
    label: "Убрать предмет",
    title: "Лишний предмет исчезает из кадра",
    description: "КЛИО убирает выбранный объект и восстанавливает изображение так, чтобы свободная область выглядела естественно.",
    before: "/landing/image-studio/autocorrect-before.webp",
    after: "/landing/image-studio/remove-object-after.webp",
  },
] as const;

export function LandingImageShowcase() {
  const [activeId, setActiveId] = useState<(typeof examples)[number]["id"]>("autocorrect");
  const [position, setPosition] = useState(50);
  const active = examples.find((item) => item.id === activeId) ?? examples[0];

  function moveComparison(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setPosition(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)));
  }

  return <section className="landing-image-showcase section" id="images-showcase">
    <div className="section-heading landing-image-showcase-heading">
      <div>
        <p className="kicker">КЛИО / Визуальный контент</p>
        <h2>Изображения для контента.<br/><em>От идеи до готовой серии<span className="klio-mark-dot">.</span></em></h2>
      </div>
      <p>Генератор изображений создаёт новые визуалы, дорабатывает ваши фотографии и собирает карусели для социальных сетей. Автокоррекция ниже — один из примеров его возможностей.</p>
    </div>

    <div className="landing-image-showcase-layout">
      <div className="landing-image-showcase-copy">
        <span className="landing-image-showcase-index">КЛИО / 02</span>
        <h3>Один инструмент для визуальной части публикации</h3>
        <ul>
          <li><b>Создание</b><span>Новая картинка по теме, описанию или референсу.</span></li>
          <li><b>Доработка</b><span>Коррекция фотографии, замена фона и изменения по вашему описанию.</span></li>
          <li><b>Карусели</b><span>Серия связанных слайдов с общей подачей для социальных сетей.</span></li>
        </ul>
        <Link className="button primary large" href="/workspace#images">Открыть генератор изображений <span aria-hidden="true">→</span></Link>
      </div>

      <div className="landing-image-demo">
        <div className="landing-image-demo-tabs" role="tablist" aria-label="Примеры доработки изображения">
          {examples.map((item) => <button type="button" role="tab" aria-selected={active.id === item.id} className={active.id === item.id ? "is-active" : ""} key={item.id} onClick={() => { setActiveId(item.id); setPosition(50); }}>{item.label}</button>)}
        </div>

        <div className="landing-image-comparison" role="slider" tabIndex={0} aria-label={`Сравнение до и после: ${active.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position)} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); moveComparison(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveComparison(event); }} onPointerUp={(event) => { moveComparison(event); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setPosition((value) => Math.max(0, value - 5)); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setPosition((value) => Math.min(100, value + 5)); } }}>
          <Image src={active.before} alt={`${active.label}: исходная фотография`} fill sizes="(max-width: 760px) 92vw, 48vw" draggable={false}/>
          <div className="landing-image-comparison-after" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            <Image src={active.after} alt={`${active.label}: результат обработки`} fill sizes="(max-width: 760px) 92vw, 48vw" draggable={false}/>
          </div>
          <span className="landing-image-comparison-label is-before">До</span>
          <span className="landing-image-comparison-label is-after">После</span>
          <i className="landing-image-comparison-divider" style={{ left: `${position}%` }} aria-hidden="true"/>
        </div>

        <label className="landing-image-comparison-control"><span>Потяните разделитель</span><input type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} aria-label={`Положение границы сравнения: ${active.label}`}/></label>
        <div className="landing-image-demo-caption"><div><b>{active.title}</b><p>{active.description}</p></div><span>До / После</span></div>
      </div>
    </div>
  </section>;
}
