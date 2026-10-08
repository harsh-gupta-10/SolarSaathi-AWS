import { createHash } from "node:crypto";
import { extractHtmlDocument } from "./html-document";
import { extractPdfDocument } from "./pdf-document";
import type { PolicyDocumentChunkV1 } from "./schema";

export type PolicyDocumentMimeType = "text/html" | "application/pdf";

export interface PolicyDocumentInput {
  sourceId: string;
  documentId: string;
  documentVersion: number;
  mimeType: string;
  bytes: Uint8Array;
}

export type IngestedPolicyChunk = PolicyDocumentChunkV1;

export interface IngestedPolicyDocument {
  schemaVersion: 1;
  mimeType: PolicyDocumentMimeType;
  sha256: string;
  normalizedTextSha256: string;
  normalizedText: string;
  title?: string;
  pageCount?: number;
  chunks: IngestedPolicyChunk[];
}

export interface DocumentIngestionLimits {
  maxHtmlBytes: number;
  maxPdfBytes: number;
  maxPages: number;
  maxNodes: number;
  maxParts: number;
  maxTextCharacters: number;
  maxPageTextCharacters: number;
  maxChunks: number;
  maxChunkCharacters: number;
}

export const DOCUMENT_INGESTION_LIMITS: Readonly<DocumentIngestionLimits> = Object.freeze({
  maxHtmlBytes: 2_000_000,
  maxPdfBytes: 8_000_000,
  maxPages: 100,
  maxNodes: 100_000,
  maxParts: 2_000,
  maxTextCharacters: 500_000,
  maxPageTextCharacters: 50_000,
  maxChunks: 1_000,
  maxChunkCharacters: 1_600,
});

export type DocumentIngestionErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "BYTE_LIMIT"
  | "MALFORMED_DOCUMENT"
  | "ENCRYPTED_PDF"
  | "PAGE_LIMIT"
  | "TEXT_LIMIT"
  | "CHUNK_LIMIT"
  | "EMPTY_DOCUMENT";

export class DocumentIngestionError extends Error {
  constructor(public readonly code: DocumentIngestionErrorCode) {
    super(code);
    this.name = "DocumentIngestionError";
  }
}

interface TextPart {
  text: string;
  pageNumber?: number;
  section?: string;
  fragment?: string;
}

function resolveLimits(override?: Partial<DocumentIngestionLimits>): DocumentIngestionLimits {
  const limits = { ...DOCUMENT_INGESTION_LIMITS };
  if (!override) return limits;
  for (const key of Object.keys(override) as Array<keyof DocumentIngestionLimits>) {
    if (!(key in limits)) throw new DocumentIngestionError("INVALID_INPUT");
    const value = override[key];
    if (!Number.isSafeInteger(value) || value! < 1 || value! > limits[key]) {
      throw new DocumentIngestionError("INVALID_INPUT");
    }
    limits[key] = value!;
  }
  return limits;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** NFC text with stable whitespace; offsets below are UTF-16 indices in this result. */
export function normalizePolicyText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (character) => character === "\n" || character === "\t" ? character : "")
    .replace(/[\u00A0\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function errorCode(error: unknown): DocumentIngestionErrorCode {
  if (error instanceof DocumentIngestionError) return error.code;
  if (error instanceof Error) {
    if (error.message === "ENCRYPTED_PDF" || error.name === "PasswordException") return "ENCRYPTED_PDF";
    if (error.message === "PAGE_LIMIT") return "PAGE_LIMIT";
    if (error.message === "TEXT_LIMIT") return "TEXT_LIMIT";
    if (error.message === "EMPTY_DOCUMENT") return "EMPTY_DOCUMENT";
    if (error.message === "PART_LIMIT") return "CHUNK_LIMIT";
  }
  return "MALFORMED_DOCUMENT";
}

function safeSplitEnd(text: string, start: number, maxCharacters: number): number {
  let end = Math.min(text.length, start + maxCharacters);
  if (end < text.length) {
    const preferred = text.lastIndexOf(" ", end);
    if (preferred > start + maxCharacters / 2) end = preferred;
    // Avoid separating a UTF-16 surrogate pair.
    if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
  }
  return end;
}

function chunksForParts(
  input: PolicyDocumentInput,
  parts: TextPart[],
  limits: DocumentIngestionLimits,
): { normalizedText: string; chunks: IngestedPolicyChunk[] } {
  const chunks: IngestedPolicyChunk[] = [];
  const documentParts: string[] = [];
  let documentLength = 0;
  for (const part of parts) {
    const text = normalizePolicyText(part.text);
    if (!text) continue;
    if (documentParts.length > 0) documentLength += 2;
    if (documentLength + text.length > limits.maxTextCharacters) {
      throw new DocumentIngestionError("TEXT_LIMIT");
    }
    const partStart = documentLength;
    documentParts.push(text);
    documentLength += text.length;
    let start = 0;
    while (start < text.length) {
      const end = safeSplitEnd(text, start, limits.maxChunkCharacters);
      if (end <= start) throw new DocumentIngestionError("INVALID_INPUT");
      const chunkText = text.slice(start, end).trim();
      if (chunkText) {
        const leadingSpace = text.slice(start, end).indexOf(chunkText);
        const charStart = partStart + start + leadingSpace;
        const charEnd = charStart + chunkText.length;
        const chunkHash = sha256(chunkText);
        const index = chunks.length;
        chunks.push({
          schemaVersion: 1,
          chunkId: `CHUNK#${index.toString().padStart(4, "0")}#${chunkHash.slice(0, 16)}`,
          sourceId: input.sourceId,
          documentId: input.documentId,
          documentVersion: input.documentVersion,
          index,
          text: chunkText,
          sha256: chunkHash,
          locator: {
            ...(part.pageNumber ? { pageNumber: part.pageNumber } : {}),
            ...(part.section ? { section: part.section } : {}),
            ...(part.fragment ? { fragment: part.fragment } : {}),
            charStart,
            charEnd,
          },
        });
        if (chunks.length > limits.maxChunks) throw new DocumentIngestionError("CHUNK_LIMIT");
      }
      start = end;
      while (text[start] === " ") start++;
    }
  }
  const normalizedText = documentParts.join("\n\n");
  if (!normalizedText || chunks.length === 0) throw new DocumentIngestionError("EMPTY_DOCUMENT");
  return { normalizedText, chunks };
}

/** Extract already-fetched bytes only. This function never fetches or interprets policy facts. */
export async function ingestPolicyDocument(
  input: PolicyDocumentInput,
  overrideLimits?: Partial<DocumentIngestionLimits>,
): Promise<IngestedPolicyDocument> {
  const limits = resolveLimits(overrideLimits);
  if (!input || !input.bytes || !(input.bytes instanceof Uint8Array) ||
      !/^SRC#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/.test(input.sourceId) ||
      !/^DOC#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/.test(input.documentId) ||
      !Number.isSafeInteger(input.documentVersion) || input.documentVersion < 1) {
    throw new DocumentIngestionError("INVALID_INPUT");
  }
  const mimeType = input.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== "text/html" && mimeType !== "application/pdf") {
    throw new DocumentIngestionError("UNSUPPORTED_MEDIA_TYPE");
  }
  if (input.bytes.length === 0 || input.bytes.length >
      (mimeType === "text/html" ? limits.maxHtmlBytes : limits.maxPdfBytes)) {
    throw new DocumentIngestionError("BYTE_LIMIT");
  }
  const rawHash = sha256(input.bytes);
  try {
    let parts: TextPart[];
    let title: string | undefined;
    let pageCount: number | undefined;
    if (mimeType === "text/html") {
      const html = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      if (!/<[a-z][\s\S]*?>/i.test(html)) throw new Error("MALFORMED_HTML");
      const extracted = extractHtmlDocument(html, {
        maxNodes: limits.maxNodes,
        maxParts: limits.maxParts,
        maxTextCharacters: limits.maxTextCharacters,
      });
      parts = extracted.parts;
      title = extracted.title;
    } else {
      if (new TextDecoder("ascii").decode(input.bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("MALFORMED_PDF");
      }
      const pages = await extractPdfDocument(input.bytes, {
        maxPages: limits.maxPages,
        maxTextCharacters: limits.maxTextCharacters,
        maxPageTextCharacters: limits.maxPageTextCharacters,
      });
      pageCount = pages.length;
      parts = pages.map((page) => ({ text: page.text, pageNumber: page.pageNumber }));
    }
    const { normalizedText, chunks } = chunksForParts(input, parts, limits);
    return {
      schemaVersion: 1,
      mimeType,
      sha256: rawHash,
      normalizedTextSha256: sha256(normalizedText),
      normalizedText,
      ...(title ? { title } : {}),
      ...(pageCount ? { pageCount } : {}),
      chunks,
    };
  } catch (error) {
    throw new DocumentIngestionError(errorCode(error));
  }
}
