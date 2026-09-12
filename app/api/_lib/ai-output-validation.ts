import Ajv, { type ValidateFunction } from "ajv";

const validator = new Ajv({ strict: false, allErrors: false, validateFormats: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
const compiled = new Map<string, ValidateFunction>();

export function assertValidAiOutput(value: unknown, schema: Record<string, unknown>) {
  const key = JSON.stringify(schema);
  let validate = compiled.get(key);
  if (!validate) {
    if (compiled.size >= 64) {
      const oldest = compiled.keys().next().value;
      if (oldest !== undefined) {
        const previous = compiled.get(oldest);
        if (previous) validator.removeSchema(previous.schema);
        compiled.delete(oldest);
      }
    }
    validate = validator.compile(schema);
    compiled.set(key, validate);
  }
  if (!validate(value)) {
    const error = validate.errors?.[0];
    // Diagnostic paths/keywords only; never copy customer content to logs.
    throw new Error(`AI_SCHEMA_MISMATCH ${error?.instancePath || "/"}: ${error?.keyword || "invalid"}`);
  }
}
