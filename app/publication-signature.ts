export function publicationBodyWithSignature(body: string, enabled: boolean, signature: string) {
  const cleanBody = body.trim();
  const cleanSignature = signature.trim();
  if (!enabled || !cleanSignature || cleanBody.endsWith(cleanSignature)) return cleanBody;
  return `${cleanBody}\n\n${cleanSignature}`.trim();
}

export function publicationBodyWithoutTrailingSignature(body: string, signature: string) {
  const cleanBody = body.trim();
  const cleanSignature = signature.trim();
  if (!cleanSignature || !cleanBody.endsWith(cleanSignature)) return cleanBody;
  return cleanBody.slice(0, -cleanSignature.length).trim();
}
