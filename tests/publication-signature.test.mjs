import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers/dialogue-harness.mjs";

const { publicationBodyWithSignature, publicationBodyWithoutTrailingSignature } = load("app/publication-signature.ts");

test("publication signature can be applied, edited, disabled and never duplicated", () => {
  const profileSignature = "С заботой о вас, КЛИО.";
  assert.equal(publicationBodyWithSignature("Текст поста", true, profileSignature), `Текст поста\n\n${profileSignature}`);
  assert.equal(publicationBodyWithSignature(`Текст поста\n\n${profileSignature}`, true, profileSignature), `Текст поста\n\n${profileSignature}`);
  assert.equal(publicationBodyWithSignature("Текст поста", false, profileSignature), "Текст поста");
  assert.equal(publicationBodyWithSignature("Текст поста", true, "Другая подпись"), "Текст поста\n\nДругая подпись");
  assert.equal(publicationBodyWithoutTrailingSignature(`Текст поста\n\n${profileSignature}`, profileSignature), "Текст поста");
});
