import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = process.env.SOLARSAATHI_POLICY_BUNDLE_DIR ?? resolve(apiDirectory, "dist");
const policy = require(resolve(bundleDirectory, "handlers/policy.js"));
const crawler = require(resolve(bundleDirectory, "handlers/policy-crawler.js"));
assert.equal(typeof policy.handler, "function");
assert.equal(typeof crawler.handler, "function");

function makePdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

process.env.ENVIRONMENT = "test";
process.env.LOG_LEVEL = "error";
process.env.AWS_REGION = "ap-south-1";
process.env.POLICY_TABLE_NAME = "bundle-smoke-table";
process.env.POLICY_DOCUMENT_BUCKET = "bundle-smoke-documents";

const sources = new Map();
const documents = new Map();
const derived = new Map();
const repository = {
  getSource: async id => sources.get(id),
  putSource: async source => { sources.set(source.sourceId, source); },
  getDocument: async (sourceId, documentId, version) => documents.get(`${sourceId}:${documentId}:${version}`),
  putDocument: async document => { documents.set(`${document.sourceId}:${document.documentId}:${document.version}`, document); },
};
const objects = {
  putImmutable: async (key, bytes) => {
    if (key.startsWith("derived/")) derived.set(key, JSON.parse(Buffer.from(bytes).toString("utf8")));
    return "bundle-smoke-version";
  },
};
const handler = policy.createPolicyHandler({
  resolveIdentity: async () => ({
    sub: "a61efe10-d953-4293-9750-62c163a2c2f8", groups: ["ADMIN_POLICY"],
    attributes: [
      { Name: "sub", Value: "a61efe10-d953-4293-9750-62c163a2c2f8" },
      { Name: "email", Value: "smoke@example.com" },
      { Name: "email_verified", Value: "true" },
    ],
  }),
  createRepository: () => repository,
  createWorkflowRepository: () => ({}),
  createObjectStore: () => objects,
  now: () => new Date("2026-10-08T00:00:00.000Z"),
});
const context = { awsRequestId: "bundle-smoke" };
const event = (path, body) => ({
  resource: path, path, httpMethod: "POST", body: JSON.stringify(body),
  isBase64Encoded: false, headers: { "content-type": "application/json" }, requestContext: {},
});

const sourceResponse = await handler(event("/v1/admin/policy/sources", {
  name: "Ministry of New and Renewable Energy", publisherName: "MNRE", jurisdiction: "IN",
  sourceType: "MNRE", canonicalUrl: "https://mnre.gov.in/solar/",
  crawlFrequency: "WEEKLY", freshnessWindowHours: 168,
}), context);
assert.equal(sourceResponse.statusCode, 201, sourceResponse.body);
const sourceId = JSON.parse(sourceResponse.body).source.sourceId;
const documentResponse = await handler(event("/v1/admin/policy/documents", {
  sourceId, version: 1, title: "Bundle smoke PDF", documentType: "CIRCULAR",
  mimeType: "application/pdf", documentUrl: "https://mnre.gov.in/solar/bundle-smoke.pdf",
  contentBase64: makePdf("Bundled PDF extraction works").toString("base64"),
}), context);
assert.equal(documentResponse.statusCode, 201, documentResponse.body);
const archived = [...derived.values()][0];
assert.match(archived.normalizedText, /Bundled PDF extraction works/);
assert.equal(archived.chunks[0].locator.pageNumber, 1);
console.log("Bundled policy handlers load and archive PDF text successfully.");
