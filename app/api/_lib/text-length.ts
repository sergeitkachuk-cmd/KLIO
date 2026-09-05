// Shared, deterministic length helpers for the generation routes
// (generate/route.ts and generate/quick/route.ts). Kept separate from
// either route so the mechanical overflow backstop can never quietly
// drift apart between the two — a generation is only as reliably
// bounded as this file, regardless of which route produced it.

export function countCharacters(value: string) {
  return value.trim().length;
}

export function publicationCharacters(material: { title: string; subtitle: string; body: string }) {
  return [material.title, material.subtitle, material.body].filter(Boolean).join("\n\n").trim().length;
}

export function bodyBudget(material: { title: string; subtitle: string }, totalTarget: number) {
  return Math.max(80, totalTarget - [material.title, material.subtitle].filter(Boolean).join("\n\n").trim().length);
}

export function trimToCharacterTarget(value: string, target: number) {
  const trimmed = value.trim().slice(0, target).trim();
  const lastStop = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("!"), trimmed.lastIndexOf("?"));
  const stopped = lastStop >= trimmed.length * 0.96 ? trimmed.slice(0, lastStop + 1) : trimmed;
  return /[.!?]$/.test(stopped) ? stopped : `${stopped}.`;
}

// Deterministic overshoot backstop for a real AI-written body. Splits on
// blank lines (the model is instructed to write section breaks this way)
// and, when there's more than one section, keeps the last one — almost
// always the conclusion/CTA — untouched, trimming only the sections
// before it. That avoids the one thing a flat character-count cut risks:
// lopping off the ending entirely. This is the absolute, non-AI ceiling —
// it always runs (or is available to run) after an AI condense pass, so a
// generation can never ship over budget purely because that pass also
// missed or failed.
export function trimOverflowBody(body: string, target: number) {
  const sections = body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (sections.length <= 1) return trimToCharacterTarget(body, target);

  const conclusion = sections.at(-1) || "";
  const conclusionLength = countCharacters(conclusion);
  if (conclusionLength >= target) return trimToCharacterTarget(body, target);

  const core = trimToCharacterTarget(sections.slice(0, -1).join("\n\n"), target - conclusionLength);
  return `${core}\n\n${conclusion}`;
}
