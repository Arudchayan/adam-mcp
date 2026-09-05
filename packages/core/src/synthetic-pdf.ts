/** Minimal PDF with one visible text operator. Fixture and unit tests only. */
export function syntheticPdfWithText(text: string): Uint8Array {
  const safe = text.replace(/[()\\]/g, " ");
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${Buffer.byteLength(stream, "latin1")}>>stream
${stream}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;
  return Buffer.from(body, "latin1");
}
