export const FOUNDATION_FIELDS = ["name", "description", "positioning", "audience", "advantages", "products", "services", "proof", "geography"] as const;
export const VOICE_FIELDS = ["voice", "vocabulary", "cta", "signature", "restrictions", "prohibited"] as const;
export type VoiceResult = Record<typeof VOICE_FIELDS[number], string>;

// Never cross the requested tab, erase data with an empty answer, or replace
// edits made while the request was running, even with replacement selected.
export function mergeProfileFill<T extends object>(current: T, snapshot: T, result: Partial<Record<keyof T, unknown>>, fields: readonly (keyof T)[], replace: boolean): T {
  const next = { ...current };
  for (const key of fields) {
    const value = result[key];
    if (typeof value !== "string" || !value.trim() || current[key] !== snapshot[key]) continue;
    if (!replace && typeof current[key] === "string" && (current[key] as string).trim()) continue;
    next[key] = value.trim() as T[keyof T];
  }
  return next;
}

export function missingVoiceFoundation(profile: { name: string; description: string; audience: string }) {
  return [!profile.name.trim() && "название компании", !profile.description.trim() && "описание компании", !profile.audience.trim() && "основную аудиторию"].filter(Boolean) as string[];
}
