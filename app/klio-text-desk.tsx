"use client";

import { memo, useMemo } from "react";
import "./klio-text-desk.css";

type Plan = { title: string; result: string; steps: readonly string[] };

export const KlioTextManuscript = memo(function KlioTextManuscript({ source, plan, busy }: { source: string; plan: Plan; busy: boolean }) {
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  return <div className={`text-desk-preview ${busy ? "is-working" : ""}`}>
    <div className="text-desk-eyebrow"><span>02 / Редакторский стол</span><span>{busy ? "В работе" : "Предпросмотр"}</span></div>
    <div className="text-desk-manuscript">
      <div className="text-desk-paper-head"><span>КЛИО / РУКОПИСЬ</span><span>Аа</span></div>
      <h3>{source.trim() ? "Ваш текст. Новый взгляд." : "Сильный текст начинается здесь."}</h3>
      {source.trim() ? <p className="text-desk-source-preview">{source.slice(0, 1800)}{source.length > 1800 ? "…" : ""}</p> : <div className="text-desk-paper-lines" aria-hidden="true"><i/><i/><i/><i/><i/></div>}
      <div className="text-desk-paper-foot"><span>{words ? `${words.toLocaleString("ru-RU")} слов` : "Добавьте исходный текст слева"}</span>{words > 0 && <span>≈ {Math.max(1, Math.ceil(words / 180))} мин чтения</span>}</div>
    </div>
    <div className="text-desk-plan" key={plan.title}>
      <div className="text-desk-eyebrow"><span>Выбранная правка</span><span>↗</span></div>
      <h3>{plan.title}</h3><p>{plan.result}</p>
      <ol>{plan.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>)}</ol>
    </div>
  </div>;
});

// Linear comparison keeps long manuscripts responsive; only the changed span is marked.
export const KlioRevisionCompare = memo(function KlioRevisionCompare({ before, after }: { before: string; after: string }) {
  const diff = useMemo(() => {
    const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    const parts = (tokens: string[]) => [tokens.slice(0, start).join(""), tokens.slice(start, end ? -end : undefined).join(""), end ? tokens.slice(-end).join("") : ""];
    return { before: parts(a), after: parts(b), changed: before !== after };
  }, [before, after]);
  return <details className="text-desk-compare"><summary>Сравнить исходник и результат <span>↗</span></summary>
    <p>Подсвечен изменённый фрагмент между общей частью в начале и конце текста.</p>
    <div>{(["before", "after"] as const).map((side) => <section key={side}><h4>{side === "before" ? "До редактуры" : "После редактуры"}</h4><p>{diff[side][0]}{diff.changed && <mark>{diff[side][1]}</mark>}{diff[side][2]}</p></section>)}</div>
  </details>;
});
