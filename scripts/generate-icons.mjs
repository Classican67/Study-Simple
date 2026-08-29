/**
 * Génère les icônes PNG de la PWA sans dépendance externe : on peint un tampon
 * RGBA à la main puis on l'encode en PNG avec le zlib de Node.
 *
 *   npm run icons
 *
 * Le dessin reproduit src/components/logo.tsx — une pile de cartes dont celle
 * du dessus porte une coche. Modifier l'un implique de relancer l'autre.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

// --- Couleurs ---------------------------------------------------------------
// La palette du projet est écrite en oklch dans globals.css. Plutôt que de
// recopier des hexadécimaux approximatifs, on convertit ici : les icônes
// restent exactement dans les mêmes teintes que l'interface.

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Encodage gamma sRGB.
  const encode = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };

  return [encode(lr), encode(lg), encode(lb), 255];
}

const GRADIENT_FROM = oklchToRgb(0.64, 0.21, 292);
const GRADIENT_TO = oklchToRgb(0.5, 0.22, 268);
const CHECK_COLOR = oklchToRgb(0.52, 0.23, 292);
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

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA

  // Chaque scanline est précédée de son octet de filtre ; 0 = aucun filtre.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Dessin -----------------------------------------------------------------

// Mélange une couleur sur le tampon selon une couverture 0..1, ce qui produit
// l'anticrénelage des bords arrondis et de la coche.
function blend(buf, size, x, y, color, coverage) {
  if (coverage <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const alpha = Math.min(1, coverage) * (color[3] / 255);
  if (alpha <= 0) return;

  const dstA = buf[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  for (let c = 0; c < 3; c++) {
    buf[i + c] = Math.round((color[c] * alpha + buf[i + c] * dstA * (1 - alpha)) / outA);
  }
  buf[i + 3] = Math.round(outA * 255);
}

// 3×3 échantillons par pixel : assez pour lisser à ces tailles.
const SS = 3;

// Couverture d'un rectangle à coins arrondis, éventuellement pivoté.
function roundedRectCoverage(px, py, { cx, cy, w, h, r, rotate = 0 }) {
  const cos = Math.cos(-rotate);
  const sin = Math.sin(-rotate);
  let hits = 0;

  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const dx = px + (sx + 0.5) / SS - cx;
      const dy = py + (sy + 0.5) / SS - cy;
      // On ramène le point dans le repère non pivoté du rectangle.
      const lx = Math.abs(dx * cos - dy * sin);
      const ly = Math.abs(dx * sin + dy * cos);

      const qx = lx - (w / 2 - r);
      const qy = ly - (h / 2 - r);
      const inside = qx <= 0 || qy <= 0 ? lx <= w / 2 && ly <= h / 2 : Math.hypot(qx, qy) <= r;
      if (inside) hits++;
    }
  }
  return hits / (SS * SS);
}

function fillRoundedRect(buf, size, rect, color, gradient) {
  const reach = Math.ceil(Math.hypot(rect.w, rect.h) / 2) + 2;
  for (let py = Math.floor(rect.cy - reach); py <= Math.ceil(rect.cy + reach); py++) {
    for (let px = Math.floor(rect.cx - reach); px <= Math.ceil(rect.cx + reach); px++) {
      const coverage = roundedRectCoverage(px, py, rect);
      if (coverage <= 0) continue;
      // Dégradé diagonal : la position sur l'axe (x+y) donne le mélange.
      const paint = gradient
        ? mix(gradient[0], gradient[1], (px + py) / (2 * size))
        : color;
      blend(buf, size, px, py, paint, coverage);
    }
  }
}

function mix(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    255,
  ];
}

// Distance d'un point au segment [a,b] : sert à tracer la coche avec des
// extrémités arrondies, comme le stroke-linecap="round" du SVG.
function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function strokePolyline(buf, size, points, width, color) {
  const radius = width / 2;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const pad = Math.ceil(radius) + 2;

  for (let py = Math.floor(Math.min(...ys) - pad); py <= Math.ceil(Math.max(...ys) + pad); py++) {
    for (let px = Math.floor(Math.min(...xs) - pad); px <= Math.ceil(Math.max(...xs) + pad); px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          let inside = false;
          for (let i = 0; i < points.length - 1; i++) {
            if (distanceToSegment(fx, fy, points[i], points[i + 1]) <= radius) {
              inside = true;
              break;
            }
          }
          if (inside) hits++;
        }
      }
      blend(buf, size, px, py, color, hits / (SS * SS));
    }
  }
}

/**
 * @param size    côté de l'icône en pixels
 * @param bleed   true = le dégradé occupe tout le carré (icône maskable et
 *                icône Apple, que le système découpe lui-même) ;
 *                false = carré à coins arrondis sur fond transparent.
 * @param content facteur d'échelle du dessin, réduit pour laisser la zone de
 *                sécurité que les masques Android peuvent rogner.
 */
function drawIcon(size, { bleed, content = 1 }) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const center = size / 2;

  fillRoundedRect(
    buf,
    size,
    { cx: center, cy: center, w: size, h: size, r: bleed ? 0 : size * 0.22 },
    null,
    [GRADIENT_FROM, GRADIENT_TO],
  );

  // Proportions reprises du viewBox 0 0 40 40 de logo.tsx.
  const u = (size / 40) * content;
  const card = { w: 16 * u, h: 20 * u, r: 3.5 * u };

  fillRoundedRect(
    buf,
    size,
    { cx: center, cy: center, ...card, rotate: (-14 * Math.PI) / 180 },
    [CARD[0], CARD[1], CARD[2], 97],
  );
  fillRoundedRect(buf, size, { cx: center, cy: center, ...card }, CARD);

  // Coche : coordonnées du SVG, ramenées au centre de l'icône.
  const point = ([x, y]) => [center + (x - 20) * u, center + (y - 20) * u];
  strokePolyline(
    buf,
    size,
    [point([16.2, 20.4]), point([18.8, 23]), point([24, 17.4])],
    2.4 * u,
    CHECK_COLOR,
  );

  return encodePng(size, buf);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, bleed: false },
  { file: "icon-512.png", size: 512, bleed: false },
  // Maskable : Android peut rogner jusqu'à 10 % de chaque bord, d'où le
  // fond à bord perdu et le contenu réduit.
  { file: "icon-maskable-512.png", size: 512, bleed: true, content: 0.72 },
  // iOS ignore la transparence et compose sur du noir : fond à bord perdu,
  // les coins étant arrondis par le système.
  { file: "apple-touch-icon.png", size: 180, bleed: true, content: 0.86 },
];

for (const target of targets) {
  writeFileSync(path.join(OUT_DIR, target.file), drawIcon(target.size, target));
  console.log(`✅ public/icons/${target.file}`);
}
