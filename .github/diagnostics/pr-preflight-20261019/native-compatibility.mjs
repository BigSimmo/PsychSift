import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire("/app/package.json");
console.log(
  JSON.stringify({
    node: process.version,
    glibc: process.report.getReport().header.glibcVersionRuntime,
    arch: process.arch,
  }),
);
for (const binding of [
  "/app/node_modules/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node",
  "/app/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.5.node",
  "/app/node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node",
]) {
  require(binding);
  console.log("Native binding loaded:", binding);
}
const React = require("react");
assert.equal(
  require("react-dom/server").renderToStaticMarkup(React.createElement("p", null, "runtime probe")),
  "<p>runtime probe</p>",
);
const sharp = require("sharp");
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#102030" } })
  .png()
  .toBuffer();
assert.equal((await sharp(png).metadata()).format, "png");
console.log("Sharp PNG round trip passed");
const canvasModule = require("/app/node_modules/pdfjs-dist/node_modules/@napi-rs/canvas");
const canvas = canvasModule.createCanvas(2, 2);
canvas.getContext("2d").fillRect(0, 0, 2, 2);
assert.ok(canvas.toBuffer("image/png").byteLength);
console.log("Canvas PNG render passed");
const pdfjs = await import("/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
assert.equal(typeof pdfjs.getDocument, "function");
console.log("PDF.js import passed");
require("next/dist/server/next-server");
require("@supabase/supabase-js");
require("@sentry/nextjs");
console.log("Next/Supabase/Sentry server imports passed; no clients or providers called");
console.log("App native/runtime compatibility probe passed");
