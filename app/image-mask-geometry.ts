export type ImageCanvasRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageContentRect = ImageCanvasRect & { scale: number };

export function containedImageRect(
  container: ImageCanvasRect,
  imageWidth: number,
  imageHeight: number,
): ImageContentRect | null {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    container.width / imageWidth,
    container.height / imageHeight,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
    scale,
  };
}

export function imagePointFromClient(
  clientX: number,
  clientY: number,
  container: ImageCanvasRect,
  imageWidth: number,
  imageHeight: number,
  clampToImage = false,
): { x: number; y: number } | null {
  const content = containedImageRect(container, imageWidth, imageHeight);
  if (!content) return null;

  if (
    !clampToImage &&
    (clientX < content.left ||
      clientX > content.left + content.width ||
      clientY < content.top ||
      clientY > content.top + content.height)
  ) {
    return null;
  }

  const x = (clientX - content.left) / content.scale;
  const y = (clientY - content.top) / content.scale;
  return {
    x: Math.max(0, Math.min(imageWidth, x)),
    y: Math.max(0, Math.min(imageHeight, y)),
  };
}

export function brushWidthInImagePixels(
  brushWidthInCssPixels: number,
  contentScale: number,
): number {
  return Math.max(1, brushWidthInCssPixels / contentScale);
}
