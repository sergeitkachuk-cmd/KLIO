// Validate the file signature rather than trusting a browser's MIME label —
// same approach as image-type.ts's imageContentType.
export function isPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}
