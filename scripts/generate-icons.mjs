/**
 * Génère les icônes PNG de la PWA sans dépendance externe : on peint un tampon
 * RGBA à la main puis on l'encode en PNG avec le zlib de Node.
 *
 *   node scripts/generate-icons.mjs
 *
 * Refaire tourner ce script après avoir changé les couleurs ci-dessous.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

const BACKGROUND = [17, 17, 19, 255]; // même teinte que theme_color
const ACCENT = [139, 108, 255, 255];
const CARD = [255, 255, 255, 255];

// --- Encodage PNG -----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  // Chaque scanline est précédée de son octet de filtre ; 0 = aucun filtre.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Dessin -----------------------------------------------------------------

function createCanvas(size, color) {
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) buffer.set(color, i * 4);
  return buffer;
}

// Mélange une couleur sur le fond selon une couverture 0..1, ce qui donne
// l'anticrénelage des bords arrondis.
function blend(buffer, size, x, y, color, coverage) {
  if (coverage <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const a = Math.min(1, coverage) * (color[3] / 255);
  for (let c = 0; c < 3; c++) {
    buffer[i + c] = Math.round(buffer[i + c] * (1 - a) + color[c] * a);
  }
  buffer[i + 3] = Math.max(buffer[i + 3], Math.round(255 * a));
}

function roundedRect(buffer, size, { x, y, w, h, r, color, rotate = 0 }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(-rotate);
  const sin = Math.sin(-rotate);
  // 3x3 échantillons par pixel : suffisant pour lisser les arrondis à ces tailles.
  const SS = 3;

  const margin = Math.ceil(Math.hypot(w, h) / 2) + 2;
  for (let py = Math.floor(cy - margin); py <= Math.ceil(cy + margin); py++) {
    for (let px = Math.floor(cx - margin); px <= Math.ceil(cx + margin); px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          // On ramène le point dans le repère non tourné du rectangle.
          const dx = fx - cx;
          const dy = fy - cy;
          const lx = Math.abs(dx * cos - dy * sin);
          const ly = Math.abs(dx * sin + dy * cos);

          const qx = lx - (w / 2 - r);
          const qy = ly - (h / 2 - r);
          const inside =
            qx <= 0 || qy <= 0
              ? lx <= w / 2 && ly <= h / 2
              : Math.hypot(qx, qy) <= r;
          if (inside) hits++;
        }
      }
      blend(buffer, size, px, py, color, hits / (SS * SS));
    }
  }
}

// Trois cartes empilées et légèrement pivotées : le logo de l'app.
function drawIcon(size, { padding }) {
  const canvas = createCanvas(size, BACKGROUND);
  const inner = size - padding * 2;

  roundedRect(canvas, size, {
    x: padding,
    y: padding,
    w: inner,
    h: inner,
    r: inner * 0.22,
    color: ACCENT,
  });

  const cardW = inner * 0.52;
  const cardH = inner * 0.66;
  const cx = size / 2;
  const cy = size / 2;

  const layers = [
    { dx: -0.09, dy: 0.02, rotate: -0.18, alpha: 90 },
    { dx: -0.04, dy: 0.01, rotate: -0.09, alpha: 160 },
    { dx: 0, dy: 0, rotate: 0, alpha: 255 },
  ];

  for (const layer of layers) {
    roundedRect(canvas, size, {
      x: cx - cardW / 2 + inner * layer.dx,
      y: cy - cardH / 2 + inner * layer.dy,
      w: cardW,
      h: cardH,
      r: cardW * 0.16,
      rotate: layer.rotate,
      color: [CARD[0], CARD[1], CARD[2], layer.alpha],
    });
  }

  return encodePng(size, size, canvas);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  // `padding: 0` : l'icône occupe tout le carré, Android arrondit lui-même.
  { file: "icon-192.png", size: 192, padding: 0 },
  { file: "icon-512.png", size: 512, padding: 0 },
  // Maskable : Android peut rogner jusqu'à 10 % de chaque bord, d'où la marge.
  { file: "icon-maskable-512.png", size: 512, padding: 62 },
];

for (const target of targets) {
  writeFileSync(path.join(OUT_DIR, target.file), drawIcon(target.size, target));
  console.log(`✅ public/icons/${target.file}`);
}
