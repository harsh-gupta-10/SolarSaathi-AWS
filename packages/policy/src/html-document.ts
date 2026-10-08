import { parse } from "parse5";

export interface ExtractedHtmlPart {
  text: string;
  section?: string;
  fragment?: string;
}

export interface ExtractedHtmlDocument {
  title?: string;
  parts: ExtractedHtmlPart[];
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
}

const IGNORED_ELEMENTS = new Set([
  "head", "script", "style", "template", "noscript", "iframe", "object",
  "embed", "svg", "canvas", "audio", "video", "form", "nav", "footer",
]);
const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl",
  "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p",
  "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead",
  "tr", "ul",
]);

function attribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function descendantText(node: HtmlNode, maxNodes: number): string {
  const text: string[] = [];
  const pending = [...(node.childNodes ?? [])].reverse();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++visited > maxNodes) throw new Error("HTML_NODE_LIMIT");
    if (current.nodeName === "#text") text.push(current.value ?? "");
    else if (!IGNORED_ELEMENTS.has(current.tagName ?? "")) {
      pending.push(...[...(current.childNodes ?? [])].reverse());
    }
  }
  return text.join(" ").replace(/\s+/gu, " ").trim();
}

function findBody(document: HtmlNode, maxNodes: number): HtmlNode | null {
  const pending = [document];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++visited > maxNodes) throw new Error("HTML_NODE_LIMIT");
    if (current.tagName === "body") return current;
    pending.push(...[...(current.childNodes ?? [])].reverse());
  }
  return null;
}

function findTitle(document: HtmlNode, maxNodes: number): string | undefined {
  const pending = [document];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++visited > maxNodes) throw new Error("HTML_NODE_LIMIT");
    if (current.tagName === "title") {
      const title = descendantText(current, maxNodes).slice(0, 300);
      return title || undefined;
    }
    pending.push(...[...(current.childNodes ?? [])].reverse());
  }
  return undefined;
}

export function extractHtmlDocument(
  html: string,
  limits: { maxNodes: number; maxParts: number; maxTextCharacters: number },
): ExtractedHtmlDocument {
  // parse5 builds a data tree. No HTML, script, style, or URL is executed.
  const document = parse(html, { scriptingEnabled: false }) as unknown as HtmlNode;
  const body = findBody(document, limits.maxNodes);
  if (!body) throw new Error("MALFORMED_HTML");
  const title = findTitle(document, limits.maxNodes);
  const parts: ExtractedHtmlPart[] = [];
  const headings: Array<{ level: number; text: string }> = [];
  let fragment: string | undefined;
  let pieces: string[] = [];
  let textCharacters = 0;

  const append = (piece: string) => {
    textCharacters += piece.length;
    if (textCharacters > limits.maxTextCharacters) throw new Error("TEXT_LIMIT");
    pieces.push(piece);
  };
  const flush = () => {
    const text = pieces.join("");
    if (text.trim()) {
      parts.push({
        text,
        section: headings.map((heading) => heading.text).join(" > ").slice(0, 200) || undefined,
        fragment,
      });
      if (parts.length > limits.maxParts) throw new Error("PART_LIMIT");
    }
    pieces = [];
  };

  const pending: Array<{ node: HtmlNode; exit: boolean }> = [{ node: body, exit: false }];
  let visited = 0;
  while (pending.length > 0) {
    const { node, exit } = pending.pop()!;
    if (++visited > limits.maxNodes * 2) throw new Error("HTML_NODE_LIMIT");
    const tag = node.tagName ?? "";
    if (exit) {
      if (BLOCK_ELEMENTS.has(tag)) append("\n");
      continue;
    }
    if (IGNORED_ELEMENTS.has(tag)) continue;
    if (node.nodeName === "#text") {
      append(node.value ?? "");
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      const heading = descendantText(node, limits.maxNodes).slice(0, 200);
      if (heading) {
        flush();
        const level = Number(tag[1]);
        while (headings.length > 0 && headings[headings.length - 1]!.level >= level) {
          headings.pop();
        }
        headings.push({ level, text: heading });
        const headingId = attribute(node, "id");
        fragment = headingId && headingId.length <= 200 ? headingId : undefined;
        append(`${heading}\n`);
      }
      continue;
    }
    if (BLOCK_ELEMENTS.has(tag)) append("\n");
    pending.push({ node, exit: true });
    for (const child of [...(node.childNodes ?? [])].reverse()) {
      pending.push({ node: child, exit: false });
    }
  }
  flush();
  if (parts.length === 0) throw new Error("EMPTY_DOCUMENT");
  return { title, parts };
}
