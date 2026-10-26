/**
 * PWA icon generator — renders public/logo.svg into every icon the manifest
 * needs. Re-run this instead of hand-editing pixels; bump the VERSION
 * constant in public/sw.js whenever icon art changes.
 *
 *   public/icon-192.png           "any" — FULLY transparent background, so the
 *                                 Windows taskbar shows no dark tile behind the mark
 *   public/icon-512.png           "any" — transparent, same as above at full size
 *   public/icon-512-maskable.png  "maskable" — opaque background, mark inset into
 *                                 the safe zone so OS masks never clip the art
 *   public/apple-touch-icon.png   180×180 — opaque background (iOS ignores alpha)
 *
 * Usage: node scripts/make-icons.mjs
 */
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.join(process.cwd(), "public");
const BACKDROP = "#020617"; // site backdrop — matches --background in globals.css

const tiles = [
  { file: "icon-192.png", size: 192, insetPct: 15, opaque: false },
  { file: "icon-512.png", size: 512, insetPct: 15, opaque: false },
  // Maskable: OS masks crop to a circle whose diameter is 80% of the tile,
  // so a square glyph must stay at ~56% width to never get clipped. 25%
  // inset → 50% art width, same visual weight as typical app-taskbar icons.
  { file: "icon-512-maskable.png", size: 512, insetPct: 25, opaque: true },
  { file: "apple-touch-icon.png", size: 180, insetPct: 10, opaque: true },
];

for (const { file, size, insetPct, opaque } of tiles) {
  // The K mark viewBox fills edge-to-edge, so render it inset-scaled and
  // center it on a full size×size tile — transparent for "any", the site
  // backdrop for "maskable"/apple (iOS ignores alpha there).
  const art = Math.round(size * (1 - insetPct / 50));
  const artBuf = await sharp(path.join(PUBLIC, "logo.svg"))
    .resize(art, art)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: opaque ? BACKDROP : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: artBuf, gravity: "centre" }])
    .png()
    .toFile(path.join(PUBLIC, file));
  console.log(`wrote public/${file}`);
}
