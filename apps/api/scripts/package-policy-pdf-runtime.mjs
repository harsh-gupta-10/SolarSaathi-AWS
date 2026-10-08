import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "..");
const policyDirectory = resolve(apiDirectory, "../../packages/policy");
const outputModules = join(apiDirectory, "dist/node_modules");

// SAM's policy functions use the x86_64 Node.js 22 Lambda runtime. A host with
// a different native target must not emit an artifact with an unusable binary.
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Build the policy Lambda artifact on Linux x64 with the installed GNU canvas binary.");
}

function packageDirectory(packageName, fromDirectory) {
  return dirname(require.resolve(`${packageName}/package.json`, { paths: [fromDirectory] }));
}

const pdf = packageDirectory("pdfjs-dist", policyDirectory);
const canvas = packageDirectory("@napi-rs/canvas", pdf);
const nativeCanvas = packageDirectory("@napi-rs/canvas-linux-x64-gnu", canvas);
for (const [source, destination] of [
  [pdf, join(outputModules, "pdfjs-dist")],
  [canvas, join(outputModules, "@napi-rs/canvas")],
  [nativeCanvas, join(outputModules, "@napi-rs/canvas-linux-x64-gnu")],
]) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
}
