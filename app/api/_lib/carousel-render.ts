import sharp from "sharp";
import type { CarouselTemplateId } from "../../carousel-templates";

type CarouselTemplate = CarouselTemplateId;

function xml(value: string) {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[char]!);
}

function wrap(text: string, maxChars: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const remainder = lines.slice(maxLines - 1).join(" ");
    kept[maxLines - 1] = remainder.length > maxChars ? `${remainder.slice(0, maxChars - 1).trimEnd()}…` : remainder;
    return kept;
  }
  return lines;
}

function tspans(lines: string[], x: number, y: number, lineHeight: number) {
  return lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${xml(line)}</tspan>`).join("");
}

function artDirection(template: CarouselTemplate) {
  if (template === "paper-light") return { panel: "#F5F4EF", border: "#D7E2EF", primary: "#10243D", secondary: "#354C66", accent: "#79A8E8", shadow: "#03152D" };
  if (template === "gradient-pop") return { panel: "#0A2340", border: "#2B5C8A", primary: "#F4F8FF", secondary: "#D2E1F2", accent: "#79A8E8", shadow: "#04142A" };
  if (template === "terminal-dev") return { panel: "#081B30", border: "#235078", primary: "#F1F6FF", secondary: "#C0D2E8", accent: "#82B2F2", shadow: "#031225" };
  return { panel: "#09223C", border: "#2A4D70", primary: "#F4F7FC", secondary: "#CAD8E9", accent: "#8EB6EE", shadow: "#03152D" };
}

/** Adds exact, readable Russian copy to the generated illustration using the KLIO template palette. */
export async function renderCarouselSlide(bytes: Uint8Array, headline: string, subtext: string, template: CarouselTemplate) {
  const source = sharp(bytes, { limitInputPixels: 40_000_000 });
  const meta = await source.metadata();
  if (!meta.width || !meta.height) throw new Error("Не удалось определить размер слайда.");
  const width = meta.width;
  const height = meta.height;
  const scale = Math.min(width, height) / 1024;
  const margin = Math.round(Math.min(width, height) * 0.065);
  const panelWidth = width - margin * 2;
  const titleSize = Math.max(24, Math.round(Math.min(height * 0.047, panelWidth * 0.075)));
  const bodySize = Math.max(18, Math.round(Math.min(height * 0.026, panelWidth * 0.046)));
  const titleMaxChars = Math.max(12, Math.floor((panelWidth - margin * 0.8) / (titleSize * 0.53)));
  const bodyMaxChars = Math.max(22, Math.floor((panelWidth - margin * 0.8) / (bodySize * 0.51)));
  const titleLines = wrap(headline, titleMaxChars, 3);
  const bodyLines = wrap(subtext, bodyMaxChars, Math.max(3, Math.floor(height * 0.34 / (bodySize * 1.42))));
  const titleLineHeight = Math.round(titleSize * 1.12);
  const bodyLineHeight = Math.round(bodySize * 1.42);
  const innerPad = Math.round(margin * 0.72);
  const panelHeight = innerPad * 2 + titleLines.length * titleLineHeight + Math.round(bodySize * 0.75) + bodyLines.length * bodyLineHeight + Math.round(30 * scale);
  const panelY = height - margin - panelHeight;
  const textX = margin + innerPad;
  const titleY = panelY + innerPad + titleSize;
  const bodyY = titleY + titleLines.length * titleLineHeight + Math.round(bodySize * 0.75) + bodySize;
  const palette = artDirection(template);
  const radius = Math.round(28 * scale);
  const eyebrow = template === "terminal-dev" ? "КЛИО  /  КОНТЕНТ" : "КЛИО  •  КОНТЕНТ ДЛЯ БИЗНЕСА";
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.panel}" stop-opacity=".97"/><stop offset="1" stop-color="${palette.panel}" stop-opacity=".91"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="${Math.round(14 * scale)}"/></filter></defs>
    <rect x="${margin}" y="${panelY + Math.round(10 * scale)}" width="${panelWidth}" height="${panelHeight}" rx="${radius}" fill="${palette.shadow}" opacity=".34" filter="url(#shadow)"/>
    <rect x="${margin}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${radius}" fill="url(#panel)" stroke="${palette.border}" stroke-width="${Math.max(2, Math.round(2 * scale))}"/>
    <rect x="${margin + innerPad}" y="${panelY + innerPad}" width="${Math.max(42, Math.round(72 * scale))}" height="${Math.max(4, Math.round(5 * scale))}" rx="3" fill="${palette.accent}"/>
    <text x="${textX}" y="${panelY + innerPad + Math.round(30 * scale)}" fill="${palette.accent}" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="${Math.round(14 * scale)}" font-weight="700" letter-spacing="${Math.round(2 * scale)}">${xml(eyebrow)}</text>
    <text fill="${palette.primary}" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="${titleSize}" font-weight="700" letter-spacing="-.3">${tspans(titleLines, textX, titleY, titleLineHeight)}</text>
    <text fill="${palette.secondary}" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="${bodySize}" font-weight="400">${tspans(bodyLines, textX, bodyY, bodyLineHeight)}</text>
  </svg>`);
  const rendered = await sharp(bytes, { limitInputPixels: 40_000_000 }).composite([{ input: svg }]).png().toBuffer();
  return { bytes: new Uint8Array(rendered), contentType: "image/png" as const };
}
