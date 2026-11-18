import type { CSSProperties } from "react";
import { IMAGE_STYLE_OPTIONS } from "./dialogue-generation-settings";

/** A settings sample, never presented as an AI-generated result. */
export function ImageCanvasPreview({ size, visualStyle, formatLabel, fileFormat, mode }: {
  size: string; visualStyle: string; formatLabel: string; fileFormat: string; mode: string;
}) {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(size);
  const width = match ? Number(match[1]) : 1024;
  const height = match ? Number(match[2]) : 1024;
  const ratio = width / height;
  const style = IMAGE_STYLE_OPTIONS.find(option => option.value === visualStyle);
  const shape = ratio > 1.3 ? "wide" : ratio < .8 ? "tall" : "square";
  const dimensions = { width: `${Math.min(310, 270 * ratio)}px`, height: `${Math.min(270, 310 / ratio)}px` } as CSSProperties;
  return <div className="canvas-sample" data-style={visualStyle || "auto"} data-shape={shape} data-mode={mode}>
    <div className="canvas-sample-stage" aria-hidden="true">
      <div className="canvas-sample-frame" style={dimensions}>
        <div className="canvas-sample-art" key={visualStyle || "auto"}>
          <div className="canvas-sample-photo"/>
          <i className="canvas-sample-sun"/><i className="canvas-sample-hill is-back"/><i className="canvas-sample-hill is-front"/>
          <i className="canvas-sample-orb"/><i className="canvas-sample-paper"/>
        </div>
        {shape === "tall" && <div className="canvas-sample-story"><i/><i/><i/></div>}
        <span className="canvas-sample-index">{mode === "carousel" ? "01 / 05" : "КЛИО / STUDIO"}</span>
        <div className="canvas-sample-type"><small>ВИЗУАЛЬНАЯ ИСТОРИЯ</small><b>{shape === "wide" ? <>Больше пространства.<br/>Для вашей идеи.</> : <>Посмотреть<br/>иначе.</>}</b></div>
        <span className="canvas-sample-corner">↗</span>
      </div>
    </div>
    <div className="canvas-sample-settings" aria-live="polite">
      <strong>{mode === "carousel" ? "Карусель" : formatLabel}</strong>
      <span>{match ? `${width} × ${height}` : "Авторазмер"}<i/> {fileFormat.toUpperCase()}</span>
      <b>{style?.label || "Авто"}</b>
    </div>
    <p className="canvas-sample-note">Образец формата и стиля</p>
  </div>;
}
