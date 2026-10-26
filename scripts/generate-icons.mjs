// Generate every PWA icon from one master image at build time.
//
// Why a build step: the manifest promises exact pixel sizes, and a mismatch
// (or a missing maskable icon) silently breaks installability. Deriving the
// icons on every build makes that class of bug impossible.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  sharp = null;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/icons");
const master = resolve(root, "assets/icon-master.png");

if (!existsSync(master)) {
  console.error("[icons] missing assets/icon-master.png — cannot generate icons");
  process.exit(1);
}

/** Existence + exact-dimension check for the committed icons. */
function validateCommitted() {
  const expected = ["icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  let ok = true;
  for (const name of expected) {
    const p = resolve(outDir, name);
    if (!existsSync(p)) { console.error(`[icons] missing ${name}`); ok = false; continue; }
    const b = readFileSync(p);
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const want = name.startsWith("icon-192") ? 192 : 512;
    if (w !== want || h !== want) { console.error(`[icons] ${name} is ${w}x${h}, want ${want}`); ok = false; }
  }
  return ok;
}

// If sharp cannot load (e.g. a builder without native binaries), fall back
// to the committed icons rather than breaking the deploy. They are checked
// for exact dimensions so a bad file can never ship silently.
if (!sharp) {
  if (validateCommitted()) {
    console.log("[icons] sharp unavailable — using committed icons (validated)");
    process.exit(0);
  }
  console.error("[icons] sharp unavailable and committed icons are invalid");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const src = readFileSync(master);

/** Glyph occupies the central 72% so Android's mask never clips the mark. */
async function maskable(size) {
  const inner = Math.round(size * 0.72);
  const glyph = await sharp(src).resize(inner, inner, { fit: "cover" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: glyph, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const jobs = [
  ["icon-192.png", await sharp(src).resize(192, 192, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer(), 192],
  ["icon-512.png", await sharp(src).resize(512, 512, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer(), 512],
  ["icon-maskable-512.png", await maskable(512), 512],
];

for (const [name, buf, size] of jobs) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(resolve(outDir, name), buf);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== size || h !== size) {
    console.error(`[icons] ${name} is ${w}x${h}, expected ${size}x${size}`);
    process.exit(1);
  }
  console.log(`[icons] ${name.padEnd(26)} ${w}x${h} ${(buf.length / 1024).toFixed(1)}KB ✓`);
}
