import { deflateSync } from "node:zlib";

/** Small valid PDFs generated solely from synthetic text for tests and fixtures. */
export function syntheticPdfWithText(text: string): Uint8Array {
  return syntheticPdfWithPages([text]);
}

export function syntheticPdfWithPages(pages: string[], compressed = false): Uint8Array {
  const literal = (text: string) => text.replace(/[()\\]/g, (char) => `\\${char}`);
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
  add("<</Type/Catalog/Pages 2 0 R>>");
  add(`<</Type/Pages/Count ${pages.length}/Kids[${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}]>>`);
  add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");
  add("<</Title (Metadata must not appear as page text)>>");
  for (const text of pages) {
    const lines = text.match(/[\s\S]{1,80}/g) ?? [""];
    const stream = Buffer.from(`BT /F1 3 Tf 3 TL 72 720 Td ${lines.map((line) => `(${literal(line)}) Tj T*`).join(" ")} ET`, "latin1");
    const bytes = compressed ? deflateSync(stream) : stream;
    add(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${objects.length + 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`);
    add(Buffer.concat([Buffer.from(`<</Length ${bytes.length}${compressed ? "/Filter/FlateDecode" : ""}>>\nstream\n`), bytes, Buffer.from("\nendstream")]));
  }
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let size = chunks[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk); size += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Info 4 0 R>>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
