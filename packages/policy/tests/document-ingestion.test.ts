import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ingestPolicyDocument, normalizePolicyText } from "../src/document-ingestion";
import { policyDocumentChunkSchema } from "../src/schema";

const encoder = new TextEncoder();

function htmlInput(html: string) {
  return {
    sourceId: "SRC#OFFICIAL",
    documentId: "DOC#NOTICE",
    documentVersion: 2,
    mimeType: "text/html; charset=utf-8",
    bytes: encoder.encode(html),
  };
}

// A small, two-page text PDF assembled with valid byte offsets. No runtime
// fixture generator or network dependency is needed by the test suite.
function makePdf(pageTexts: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[\\()]/g, "\\$&");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  ];
  for (let i = 0; i < pageTexts.length; i++) {
    const stream = `BT /F1 12 Tf 50 750 Td (${escape(pageTexts[i]!)}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageTexts.length * 2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

function pdfInput(bytes: Uint8Array) {
  return {
    sourceId: "SRC#OFFICIAL",
    documentId: "DOC#CIRCULAR",
    documentVersion: 3,
    mimeType: "application/pdf",
    bytes,
  };
}

describe("policy document ingestion", () => {
  it("normalizes Unicode and whitespace without deleting Indic letters", () => {
    expect(normalizePolicyText(" योजना\u00a0  पात्रता\r\n\r\nराशि ")).toBe("योजना पात्रता\n\nराशि");
  });

  it("extracts visible HTML by headed section, preserves real fragments, excludes executable content", async () => {
    const html = `<!doctype html><html><head><title>Official circular</title><script>secret()</script></head><body>
      <nav>Portal navigation</nav><h1 id="overview">Overview</h1><p>Eligibility &amp; requirements.</p>
      <h2 id="dates">Dates</h2><p>Effective from 1 April.</p><style>.hidden{}</style>
      <iframe src="https://example.invalid/evil"></iframe></body></html>`;
    const result = await ingestPolicyDocument(htmlInput(html));
    expect(result.title).toBe("Official circular");
    expect(result.mimeType).toBe("text/html");
    expect(result.normalizedText).toContain("Eligibility & requirements.");
    expect(result.normalizedText).not.toMatch(/secret\(\)|hidden|evil/);
    expect(result.chunks.some((chunk) => chunk.locator.section === "Overview" && chunk.locator.fragment === "overview")).toBe(true);
    expect(result.chunks.some((chunk) => chunk.locator.section === "Overview > Dates" && chunk.locator.fragment === "dates")).toBe(true);
    for (const chunk of result.chunks) {
      expect(policyDocumentChunkSchema.safeParse(chunk).success).toBe(true);
      expect(result.normalizedText.slice(chunk.locator.charStart, chunk.locator.charEnd)).toBe(chunk.text);
      expect(chunk.sha256).toBe(createHash("sha256").update(chunk.text).digest("hex"));
    }
  });

  it("uses exact byte hash and stable text/chunk hashes across repeat extraction", async () => {
    const input = htmlInput("<html><body><h1>Rule</h1><p>A &amp; B</p></body></html>");
    const first = await ingestPolicyDocument(input);
    const second = await ingestPolicyDocument(input);
    expect(first).toEqual(second);
    expect(first.sha256).toBe(createHash("sha256").update(input.bytes).digest("hex"));
    expect(first.normalizedTextSha256).toBe(createHash("sha256").update(first.normalizedText).digest("hex"));
  });

  it("keeps Unicode chunk offsets aligned with normalized source text", async () => {
    const result = await ingestPolicyDocument(htmlInput(
      "<html><body><h1 id=hi>योजना ☀️</h1><p>पात्रता और राशि उपलब्ध हैं।</p></body></html>",
    ), { maxChunkCharacters: 17 });
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(result.normalizedText.slice(chunk.locator.charStart, chunk.locator.charEnd)).toBe(chunk.text);
      expect(chunk.locator.section).toBe("योजना ☀️");
    }
  });

  it("splits long sections deterministically without crossing section locators", async () => {
    const input = htmlInput(`<html><body><h1>First</h1><p>${"rule ".repeat(30)}</p><h1>Second</h1><p>${"date ".repeat(30)}</p></body></html>`);
    const result = await ingestPolicyDocument(input, { maxChunkCharacters: 40 });
    expect(result.chunks.length).toBeGreaterThan(4);
    expect(result.chunks.every((chunk) => chunk.text.length <= 40)).toBe(true);
    expect(new Set(result.chunks.map((chunk) => chunk.locator.section))).toEqual(new Set(["First", "Second"]));
    expect(result.chunks.map((chunk) => chunk.index)).toEqual(result.chunks.map((_, index) => index));
  });

  it("extracts real PDF text with page-specific citation locators", async () => {
    const input = pdfInput(makePdf(["Page one eligibility", "Page two deadline"]));
    const result = await ingestPolicyDocument(input);
    expect(result.pageCount).toBe(2);
    expect(result.normalizedText).toContain("Page one eligibility");
    expect(result.normalizedText).toContain("Page two deadline");
    expect(result.chunks.map((chunk) => chunk.locator.pageNumber)).toEqual([1, 2]);
    for (const chunk of result.chunks) {
      expect(result.normalizedText.slice(chunk.locator.charStart, chunk.locator.charEnd)).toBe(chunk.text);
    }
  });

  it("rejects unsupported types, invalid bytes, malformed UTF-8, and empty pages", async () => {
    await expect(ingestPolicyDocument({ ...htmlInput("<p>test</p>"), mimeType: "image/svg+xml" })).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    await expect(ingestPolicyDocument(htmlInput("<p>test</p>"), { maxHtmlBytes: 2 })).rejects.toMatchObject({ code: "BYTE_LIMIT" });
    await expect(ingestPolicyDocument({ ...htmlInput(""), bytes: new Uint8Array([60, 112, 62, 255]) })).rejects.toMatchObject({ code: "MALFORMED_DOCUMENT" });
    await expect(ingestPolicyDocument(htmlInput("<html><body><script>onlyScript()</script></body></html>"))).rejects.toMatchObject({ code: "EMPTY_DOCUMENT" });
    await expect(ingestPolicyDocument(pdfInput(encoder.encode("%PDF-broken")))).rejects.toMatchObject({ code: "MALFORMED_DOCUMENT" });
  });

  it("enforces page, text and chunk budgets before returning content", async () => {
    const pdf = pdfInput(makePdf(["first", "second"]));
    await expect(ingestPolicyDocument(pdf, { maxPages: 1 })).rejects.toMatchObject({ code: "PAGE_LIMIT" });
    await expect(ingestPolicyDocument(pdf, { maxTextCharacters: 5 })).rejects.toMatchObject({ code: "TEXT_LIMIT" });
    const html = htmlInput(`<html><body><p>${"word ".repeat(30)}</p></body></html>`);
    await expect(ingestPolicyDocument(html, { maxChunkCharacters: 20, maxChunks: 2 })).rejects.toMatchObject({ code: "CHUNK_LIMIT" });
    await expect(ingestPolicyDocument(html, { maxTextCharacters: 20 })).rejects.toMatchObject({ code: "TEXT_LIMIT" });
    await expect(ingestPolicyDocument(html, { maxNodes: 1 })).rejects.toMatchObject({ code: "MALFORMED_DOCUMENT" });
  });

  it("rejects an encrypted PDF without accepting or prompting for a password", async () => {
    const bytes = await readFile(new URL("./fixtures/encrypted.pdf", import.meta.url));
    await expect(ingestPolicyDocument(pdfInput(bytes))).rejects.toMatchObject({ code: "ENCRYPTED_PDF" });
  });
});
