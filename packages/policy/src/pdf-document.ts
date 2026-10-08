import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export async function extractPdfDocument(
  bytes: Uint8Array,
  limits: { maxPages: number; maxTextCharacters: number; maxPageTextCharacters: number },
): Promise<ExtractedPdfPage[]> {
  // Only an in-memory byte array is supplied: PDF.js cannot fetch an arbitrary URL.
  // XFA rendering, worker fetching, and recovery from malformed text streams are disabled.
  const task = getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    stopAtErrors: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    useWorkerFetch: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const document = await task.promise;
    if (document.numPages === 0 || document.numPages > limits.maxPages) {
      throw new Error("PAGE_LIMIT");
    }
    const pages: ExtractedPdfPage[] = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pieces: string[] = [];
        let pageCharacters = 0;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const piece = `${item.str}${item.hasEOL ? "\n" : " "}`;
          pageCharacters += piece.length;
          totalCharacters += piece.length;
          if (pageCharacters > limits.maxPageTextCharacters ||
              totalCharacters > limits.maxTextCharacters) throw new Error("TEXT_LIMIT");
          pieces.push(piece);
        }
        pages.push({ pageNumber, text: pieces.join("") });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("ENCRYPTED_PDF");
    }
    throw error;
  } finally {
    await task.destroy();
  }
}
