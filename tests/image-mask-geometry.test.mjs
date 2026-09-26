import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/image-mask-geometry.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const geometry = {};
vm.runInNewContext(compiled, { exports: geometry });

test("brush coordinates map to the visible image inside landscape letterboxing", () => {
  const container = { left: 20, top: 40, width: 800, height: 600 };
  const content = geometry.containedImageRect(container, 1024, 1024);
  assert.deepEqual({ left: content.left, top: content.top, width: content.width, height: content.height }, { left: 120, top: 40, width: 600, height: 600 });
  const center = geometry.imagePointFromClient(420, 340, container, 1024, 1024);
  assert.equal(center.x, 512);
  assert.equal(center.y, 512);
  assert.equal(geometry.imagePointFromClient(40, 340, container, 1024, 1024), null, "pointer in a side letterbox is not painted");
});

test("portrait sources use the displayed image bounds and clamp a captured stroke at its edge", () => {
  const container = { left: 10, top: 15, width: 800, height: 600 };
  const content = geometry.containedImageRect(container, 1024, 1536);
  assert.deepEqual({ left: content.left, top: content.top, width: content.width, height: content.height }, { left: 210, top: 15, width: 400, height: 600 });
  assert.equal(geometry.imagePointFromClient(200, 300, container, 1024, 1536), null);
  const edge = geometry.imagePointFromClient(800, 300, container, 1024, 1536, true);
  assert.equal(edge.x, 1024);
  assert.equal(edge.y, 729.6);
});

test("brush diameter remains a screen-pixel size at different zoom levels", () => {
  assert.equal(geometry.brushWidthInImagePixels(8, 0.5), 16);
  assert.equal(geometry.brushWidthInImagePixels(8, 2), 4);
});
