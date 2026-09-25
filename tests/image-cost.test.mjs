import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers/dialogue-harness.mjs";

const { normalizeImageUsage, aggregateImageUsages } = load("app/api/_lib/image-cost.ts");

test("image provider usage is converted to a cost and marked as provider data", () => {
  const usage = normalizeImageUsage({
    input_tokens: 1_000_000,
    input_tokens_details: { image_tokens: 800_000, text_tokens: 200_000, cached_tokens: 100_000 },
    output_tokens: 2_000_000,
    output_tokens_details: { image_tokens: 2_000_000 },
    total_tokens: 3_000_000,
  }, { model: "gpt-image-2.5-flare", promptCharacters: 100 });
  assert.equal(usage.costSource, "provider");
  assert.equal(usage.totalTokens, 3_000_000);
  assert.equal(usage.estimatedCostUsd, 66.8);
});

test("missing usage gets a bounded estimate and carousel usage aggregates", () => {
  const first = normalizeImageUsage(undefined, { model: "gpt-image-2.5-flare", promptCharacters: 400, size: "1536x1024", quality: "max", partialImages: 2 });
  const second = normalizeImageUsage(undefined, { model: "gpt-image-2.5-flare", promptCharacters: 200, size: "1024x1024", quality: "high" });
  assert.equal(first.costSource, "estimate");
  assert.ok(first.estimatedCostUsd > 0);
  const total = aggregateImageUsages([first, second]);
  assert.equal(total.costSource, "estimate");
  assert.equal(total.totalTokens, first.totalTokens + second.totalTokens);
  assert.equal(total.estimatedCostUsd, first.estimatedCostUsd + second.estimatedCostUsd);
});
