"use client";

import Image from "next/image";
import { useCallback, useRef, useState, type PointerEvent } from "react";

type Props = { src: string; onMaskChange: (maskBase64: string) => void };

export default function ImageMaskEditor({ src, onMaskChange }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(7);
  const [hasStroke, setHasStroke] = useState(false);

  const setup = useCallback(() => {
    const image = imageRef.current;
    const paint = paintRef.current;
    const mask = maskRef.current;
    if (!image || !paint || !mask || !image.naturalWidth || !image.naturalHeight) return;
    for (const canvas of [paint, mask]) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }
    const context = mask.getContext("2d");
    if (context) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, mask.width, mask.height);
    }
    setHasStroke(false);
    onMaskChange("");
  }, [onMaskChange]);

  const coords = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  };
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = coords(event);
    const paint = paintRef.current?.getContext("2d");
    const mask = maskRef.current?.getContext("2d");
    if (!paint || !mask) return;
    const width = Math.max(10, brushSize * paint.canvas.width / Math.max(1, event.currentTarget.clientWidth));
    for (const [context, color] of [[paint, "rgba(77, 194, 255, .45)"] as const, [mask, "rgba(0, 0, 0, 1)"] as const]) {
      context.save();
      if (context === mask) context.globalCompositeOperation = "destination-out";
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = width;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (lastPointRef.current) {
        context.beginPath(); context.moveTo(lastPointRef.current.x, lastPointRef.current.y); context.lineTo(point.x, point.y); context.stroke();
      } else {
        context.beginPath(); context.arc(point.x, point.y, width / 2, 0, Math.PI * 2); context.fill();
      }
      context.restore();
    }
    lastPointRef.current = point;
    setHasStroke(true);
  };
  const finish = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    const encoded = maskRef.current?.toDataURL("image/png").split(",")[1] || "";
    onMaskChange(encoded);
  };
  const clear = () => {
    const paint = paintRef.current;
    const mask = maskRef.current;
    if (!paint || !mask) return;
    paint.getContext("2d")?.clearRect(0, 0, paint.width, paint.height);
    const context = mask.getContext("2d");
    if (context) { context.globalCompositeOperation = "source-over"; context.fillStyle = "#000"; context.fillRect(0, 0, mask.width, mask.height); }
    setHasStroke(false); onMaskChange("");
  };

  return <div className="image-mask-editor">
    <div className="image-mask-editor-tools">
      <span>Кистью отметьте область для изменения</span>
      <label>Размер <input type="range" min="3" max="24" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))}/></label>
      <button type="button" className="button ghost" onClick={clear} disabled={!hasStroke}>Сбросить область</button>
    </div>
    <div className="image-mask-editor-canvas">
      <Image ref={imageRef} src={src} alt="Изображение для редактирования" width={1024} height={768} unoptimized onLoad={setup}/>
      <canvas ref={paintRef} aria-label="Выбранная кистью область" onPointerDown={event => { drawingRef.current = true; lastPointRef.current = null; event.currentTarget.setPointerCapture(event.pointerId); draw(event); }} onPointerMove={event => { if (drawingRef.current) draw(event); }} onPointerUp={finish} onPointerCancel={finish}/>
      <canvas ref={maskRef} className="image-mask-editor-mask" />
    </div>
    <small>Голубым отмечается участок, который КЛИО сможет перерисовать. Остальная часть останется ориентиром.</small>
  </div>;
}
