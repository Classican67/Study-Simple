/*
 * Un document ou une photo doit remplir l'écran, en portrait comme en paysage.
 *
 * La fenêtre d'une page manuscrite était plafonnée à 520 px : en paysage sur
 * iPad, cela remplissait l'écran à peu près ; en portrait, la page s'arrêtait
 * au milieu de l'écran avec la moitié du document coupée dessous. Et le plein
 * écran calculait sa hauteur une seule fois, à l'ouverture : tourner l'iPad
 * laissait une feuille trop courte, ou trop longue et rognée par la palette.
 *
 * On mesure donc, pour chaque appareil et chaque orientation, la place perdue
 * sous la fenêtre quand la page en a plus à montrer, et ce qu'elle cache sous
 * la barre du bas — puis on tourne l'écran et on recommence.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);

const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();
const DOC = sql(
  `select n.id from NoteBlock b join Note n on n.id=b.noteId where b.kind='drawing' and b.content like '%.pdf"%' order by length(b.content) desc limit 1;`,
);
if (!DOC) {
  console.log("❌ une note portant un document est nécessaire dans la base de vérification");
  process.exit(1);
}

/** Tolérance : un arrondi de mise en page, pas un défaut. */
const JEU = 24;

const appareils = [
  ["iPad 11", 834, 1194],
  ["iPad mini", 744, 1133],
  ["iPhone 15", 393, 852],
];

const browser = await chromium.launch();

/** Amène la palette du bloc juste sous la barre du haut, puis mesure. */
async function mesurerEnLigne(page) {
  await page.evaluate(() => {
    const palette = document.querySelector('section [role="toolbar"]');
    const barre = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    window.scrollBy(0, palette.getBoundingClientRect().top - barre - 8);
  });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const scroller = document.querySelector("section [data-ink-scroll]");
    const s = scroller.getBoundingClientRect();
    const pile = scroller.firstElementChild.getBoundingClientRect().height;
    const nav = [...document.querySelectorAll("nav")]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.bottom >= innerHeight - 1 && r.top > innerHeight / 2)
      .map((r) => r.top);
    const bas = Math.min(innerHeight, ...nav);
    return {
      ecran: [innerWidth, innerHeight],
      haut: Math.round(s.top),
      fenetre: Math.round(s.height),
      pile: Math.round(pile),
      // Écran laissé vide sous la fenêtre alors que la page continue.
      perdu: s.height < pile - 1 ? Math.round(bas - s.bottom) : 0,
      // Fenêtre qui passe sous la barre du bas ou hors de l'écran.
      cache: Math.max(0, Math.round(s.bottom - bas)),
      // Et une bande pour faire défiler la note au doigt, hors de la surface.
      horsSurface: Math.round(innerHeight - s.height),
    };
  });
}

async function mesurerPlein(page) {
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const plein = document.querySelector(".ink-surface.fixed");
    const scroller = plein.querySelector("[data-ink-scroll]");
    const s = scroller.getBoundingClientRect();
    const pal = plein.querySelector('[role="toolbar"]').getBoundingClientRect();
    return {
      ecran: [innerWidth, innerHeight],
      haut: Math.round(s.top),
      bas: Math.round(s.bottom),
      palette: Math.round(pal.top),
      pile: Math.round(scroller.firstElementChild.getBoundingClientRect().height),
    };
  });
}

function jugerEnLigne(nom, m) {
  console.log(`   ${nom}`, JSON.stringify(m));
  check(m.perdu <= JEU, `${nom} : la page remplit l'écran`, `${m.perdu} px vides sous une page coupée`);
  check(m.cache <= 2, `${nom} : rien de la page n'est caché`, `${m.cache} px sous la barre ou hors écran`);
  check(m.horsSurface >= 120, `${nom} : il reste de quoi faire défiler la note au doigt`, `${m.horsSurface} px`);
}

function jugerPlein(nom, m) {
  console.log(`   ${nom}`, JSON.stringify(m));
  const attendu = Math.min(m.palette, m.pile);
  check(Math.abs(m.bas - attendu) <= 2 && m.haut === 0, `${nom} : la feuille va jusqu'à la palette`, `bas ${m.bas}, palette ${m.palette}`);
}

for (const [nom, w, h] of appareils) {
  section(nom);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "aucune erreur de page", String(e).slice(0, 160)));

  await page.goto(`${BASE}/notes/${DOC}`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="drawing-canvas"]').first().waitFor();
  await page.waitForTimeout(1200);

  const cle = nom.replace(/ /g, "-");
  jugerEnLigne(`${nom} portrait, en ligne`, await mesurerEnLigne(page));
  await page.screenshot({ path: `shots/orientation-${cle}-portrait.png` });

  // On tourne l'appareil, sans recharger.
  await page.setViewportSize({ width: h, height: w });
  await page.waitForTimeout(800);
  jugerEnLigne(`${nom} paysage, en ligne`, await mesurerEnLigne(page));
  await page.screenshot({ path: `shots/orientation-${cle}-paysage.png` });

  // Plein écran ouvert en paysage, puis tourné en portrait : c'est le cas
  // qu'un calcul fait une fois pour toutes laissait coupé.
  await page.getByRole("button", { name: /plein écran/i }).first().click();
  jugerPlein(`${nom} paysage, plein écran`, await mesurerPlein(page));
  await page.setViewportSize({ width: w, height: h });
  jugerPlein(`${nom} tourné en portrait, plein écran`, await mesurerPlein(page));
  await page.screenshot({ path: `shots/orientation-${cle}-plein-portrait.png` });
  await page.setViewportSize({ width: h, height: w });
  jugerPlein(`${nom} retourné en paysage, plein écran`, await mesurerPlein(page));
  await page.keyboard.press("Escape");

  await ctx.close();
}

await browser.close();
console.log(ko === 0 ? "\nLa page remplit l'écran dans les deux orientations." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
