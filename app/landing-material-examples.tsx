"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, Copy } from "lucide-react";
import "./landing-material-examples.css";

const title = "Истории начинаются с маленьких деталей";
const paragraphs = [
  "Первый глоток кофе. Свет из окна. Пара слов, сказанных с заботой. Именно из таких моментов складывается характер места, в которое хочется возвращаться.",
  "В «Месте встречи» мы любим эти простые ритуалы: запомнить ваш любимый напиток, предложить попробовать новое зерно и оставить время для неспешного разговора.",
  "Загляните по пути. Ваша чашка и ваша маленькая история уже ждут вас.",
];
const topics = [
  {category:"Выбор кофе",title:"Как найти свой кофе: от первого глотка до любимого зерна",query:"кофе для дома",angle:"Объяснить вкус через привычные ощущения, без сложного словаря бариста.",goal:"Помочь новичку выбрать зерно для дома.",points:["Какие вкусы вам нравятся","Чем отличается обжарка","Ваш способ заваривания","Как попробовать новое"]},
  {category:"Люди",title:"Утро за стойкой: история человека, который готовит ваш капучино",query:"бариста кофейни",angle:"Показать человека за ежедневным ритуалом: внимание, привычки и любимые детали работы.",goal:"Познакомить гостей с командой.",points:["С чего начинается утро","Любимый напиток бариста","Как запоминают гостей","Совет для вашей чашки"]},
  {category:"Вкусы",title:"Фильтр или эспрессо: два характера одного зерна",query:"фильтр и эспрессо разница",angle:"Сравнить способы по вкусу и ситуации, без рейтинга «лучше — хуже».",goal:"Помочь выбрать напиток под настроение.",points:["Плотность и аромат","Объём и темп","Что меняется в зерне","С чего начать знакомство"]},
];
const photos = [
  {src:"/dialogue/card-photos/ocean.jpg",title:"Пауза, которую хочется сохранить",format:"Пост · 1:1"},
  {src:"/dialogue/card-photos/architecture.jpg",title:"Новый взгляд на привычное",format:"Обложка · 3:2"},
];

/** Individual result fragments, without a miniature or invented workspace shell. */
export function LandingMaterialExamples({ format }: {format:number}) {
  const [copied,setCopied]=useState(false);
  const [topic,setTopic]=useState(0);
  const [photo,setPhoto]=useState(0);
  const [day,setDay]=useState(3);
  async function copy() {
    try { await navigator.clipboard.writeText([title,...paragraphs].join("\n\n"));setCopied(true); } catch { setCopied(false); }
  }
  return <div className={`kl-result-example kl-result-format-${format}`}>
    {format===0 && <article className="kl-example-text">
      <div className="kl-example-meta"><span><i/>Создано КЛИО</span><span>Пост для социальных сетей</span></div>
      <h3>{title}</h3><p className="kl-example-lead">О маленьких ритуалах, из которых складывается любовь к своему месту.</p>
      <div className="kl-example-prose">{paragraphs.map(p=><p key={p}>{p}</p>)}</div>
      <div className="kl-example-text-foot"><span><Check size={16}/>Профиль бренда учтён</span><button type="button" onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?"Скопировано":"Копировать текст"}</button></div>
    </article>}
    {format===1 && <div className="kl-example-images">
      <figure><Image src={photos[photo].src} alt={photos[photo].title} width={1000} height={800}/><figcaption><span>{photos[photo].format}</span><a href={photos[photo].src} download aria-label="Скачать пример изображения"><ArrowDownToLine size={18}/></a></figcaption></figure>
      <div className="kl-example-image-copy"><span className="kl-example-kicker">Готовое изображение</span><h3>{photos[photo].title}</h3><p>Спокойная палитра, мягкий свет и внимание к деталям. Для истории, в которой хочется задержаться.</p><div className="kl-example-thumbs" role="group" aria-label="Примеры изображений">{photos.map((item,i)=><button type="button" key={item.src} aria-label={item.title} aria-pressed={photo===i} onClick={()=>setPhoto(i)}><Image src={item.src} alt="" width={160} height={120}/></button>)}</div><small>Примеры визуалов</small></div>
    </div>}
    {format===2 && <div className="kl-example-topics">{topics.map((item,i)=><article className={topic===i?"is-open":""} key={item.title}>
      <button type="button" className="kl-example-topic-toggle" aria-expanded={topic===i} aria-controls={`example-topic-${i}`} onClick={()=>setTopic(topic===i?-1:i)}><span className="kl-example-topic-index">0{i+1}</span><span><span className="kl-example-topic-category">{item.category} <em>{i===0?"SEO-статья":"Пост"}</em></span><strong>{item.title}</strong><small>{item.query}</small></span><ChevronDown size={22}/></button>
      <div className="kl-example-topic-detail" id={`example-topic-${i}`} inert={topic!==i}><div><div className="kl-example-topic-brief"><span className="kl-example-kicker">Редакционный ракурс</span><p>{item.angle}</p><small>{item.goal}</small></div><div className="kl-example-topic-outline"><span className="kl-example-kicker">Внутри материала</span><ol>{item.points.map(point=><li key={point}>{point}</li>)}</ol></div></div></div>
    </article>)}</div>}
    {format===3 && <div className="kl-example-publications">
      <div className="kl-example-week" role="group" aria-label="Выбрать день публикации">{["ПН","ВТ","СР","ЧТ","ПТ","СБ","ВС"].map((label,i)=><button key={label} type="button" aria-pressed={day===i} onClick={()=>setDay(i)}><small>{label}</small><b>{16+i}</b><i/></button>)}</div>
      <div className="kl-example-post-date"><h3>{16+day} ноября</h3><span>Публикаций: 1</span></div>
      <article className="kl-example-post" style={{backgroundImage:`linear-gradient(110deg,#17151d99,#17151dc9),url('${photos[day%2].src}')`}}><div className="kl-example-post-meta"><span>{day%2?"Telegram":"ВКонтакте"}</span><time>11:00</time><ArrowUpRight size={18}/></div><h3>{day%2?title:"Пауза, которую хочется сохранить"}</h3><p>{paragraphs[0]}</p><div className="kl-example-post-foot"><span>Место встречи</span><em>Запланировано</em></div></article>
    </div>}
  </div>;
}
