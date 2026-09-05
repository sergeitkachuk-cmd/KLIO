import test from "node:test";
import assert from "node:assert/strict";
import { mergeProfileFill, FOUNDATION_FIELDS, VOICE_FIELDS, missingVoiceFoundation } from "../app/brand-profile-fill.ts";

const profile = () => Object.fromEntries([...FOUNDATION_FIELDS, ...VOICE_FIELDS].map(key => [key, ""]));

test("foundation fill preserves manual values and cannot change voice", () => {
  const before = { ...profile(), name: "Manual name", voice: "Manual voice" };
  const next = mergeProfileFill(before, before, { name: "AI name", description: "New description", voice: "AI voice" }, FOUNDATION_FIELDS, false);
  assert.equal(next.name, "Manual name");
  assert.equal(next.description, "New description");
  assert.equal(next.voice, "Manual voice");
});
test("voice fill covers all six fields without changing foundation", () => {
  const before = { ...profile(), description: "Company facts" };
  const result = Object.fromEntries(VOICE_FIELDS.map(key => [key, key === "signature" ? "" : `Proposed ${key}`]));
  const next = mergeProfileFill(before, before, { ...result, description: "Wrong facts" }, VOICE_FIELDS, false);
  for (const key of VOICE_FIELDS) assert.equal(next[key], result[key]);
  assert.equal(next.description, before.description);
});
test("explicit replacement changes existing fields but preserves newer edits", () => {
  const before = { ...profile(), voice: "Old voice", cta: "Old action" };
  const current = { ...before, cta: "Typed during request" };
  const next = mergeProfileFill(current, before, { voice: "New voice", cta: "New action" }, VOICE_FIELDS, true);
  assert.equal(next.voice, "New voice");
  assert.equal(next.cta, "Typed during request");
});
test("sparse or malformed results never erase stored data", () => {
  const before = { ...profile(), voice: "Voice", signature: "Signature", restrictions: "Rules" };
  assert.deepEqual(mergeProfileFill(before, before, { voice: "  ", signature: null, restrictions: {} }, VOICE_FIELDS, true), before);
});
test("default filling also preserves an edit made in an initially empty field", () => {
  const before = profile();
  const current = { ...before, vocabulary: "User terms" };
  assert.equal(mergeProfileFill(current, before, { vocabulary: "AI terms" }, VOICE_FIELDS, false).vocabulary, "User terms");
});
test("voice requires only the named minimum foundation fields", () => {
  assert.equal(missingVoiceFoundation(profile()).length, 3);
  assert.deepEqual(missingVoiceFoundation({ name: "Name", description: "Description", audience: "Audience" }), []);
});
