/*
 * **Un long document s'annote sans limite, et chaque trait s'enregistre.**
 *
 * Un polycopié importé est un seul bloc : toutes ses pages, tous ses traits.
 * Deux plafonds faisaient qu'au bout d'un moment on annotait pour rien :
 *
 * - le bloc était refusé au-delà de deux mégaoctets (413), soit quatre cents
 *   traits — et la file cessait de réessayer ;
 * - `parseDrawing` ne relisait que les quatre mille premiers traits : le
 *   reste disparaissait au rechargement.
 *
 * On part donc d'un document de trente pages déjà chargé de cinq mille traits
 * (une vingtaine de mégaoctets), posé directement en base, et l'on prouve :
 *
 * 1. qu'un trait de plus s'enregistre, et que **seul ce trait voyage** — pas
 *    les vingt mégaoctets ;
 * 2. que tout est là au rechargement, au-delà de quatre mille ;
 * 3. que si la base a bougé derrière le dos de l'onglet, le serveur refuse le
 *    morceau (409) et l'onglet renvoie tout — un envoi de plus de dix
 *    mégaoctets, qui passe le proxy de Next sans être tronqué.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const dire = (label, valeur) => console.log(`   ${label} : ${valeur}`);
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q], { maxBuffer: 1 << 30 }).toString().trim();
const TMP = path.resolve("long-document.tmp.json");
// Repris de `PAGE_GAP` (lib/notes.ts), lu dans le source pour ne pas diverger.
const PAGE_GAP = Number(
  readFileSync("../src/lib/notes.ts", "utf8").match(/export const PAGE_GAP = ([0-9.]+)/)[1],
);

/** Un document de `pages` pages et `traits` traits de 200 points, dans l'ordre de `parseDrawing`. */
function documentLourd(pages, traits) {
  const ratio = 1.414;
  const listePages = Array.from({ length: pages }, () => ({ paper: "ruled", ratio }));
  const strokes = [];
  let graine = 3;
  const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < traits; t++) {
    const page = t % pages;
    const y0 = page * ratio + 0.1 + hasard() * (ratio - 0.2);
    const x0 = 0.1 + hasard() * 0.7;
    const points = [];
    for (let i = 0; i < 200; i++) {
      points.push(
        Math.round((x0 + i * 0.0006) * 1e4) / 1e4,
        Math.round((y0 + Math.sin(i / 9) * 0.004) * 1e4) / 1e4,
        Math.round((0.4 + hasard() * 0.3) * 1e3) / 1e3,
      );
    }
    strokes.push({ color: "ink", size: 2, tool: "pen", points });
  }
  // Le ratio **tel que l'app le recalcule** (`surfaceRatio`) : posé autrement,
  // l'onglet le réécrit au premier enregistrement, et ce premier envoi porte
  // alors un écart au début du texte et le trait neuf à la fin — un morceau
  // aussi gros que le document, que le transport envoie entier à raison.
  const surface = listePages.reduce((total, p) => total + p.ratio, 0) + PAGE_GAP * (pages - 1);
  return { ratio: surface, paper: "blank", pages: listePages, strokes };
}

function poserEnBase(blockId, contenu) {
  writeFileSync(TMP, JSON.stringify(contenu));
  sql(`update NoteBlock set content = cast(readfile('${TMP}') as text) where id = '${blockId}';`);
}

function contenuEnBase(blockId) {
  return JSON.parse(sql(`select content from NoteBlock where id = '${blockId}';`));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 180));
  ko++;
});

// Chaque enregistrement : taille du corps, nature, statut.
const envois = [];
page.on("request", (req) => {
  if (req.method() === "PUT" && /\/blocks\//.test(req.url())) {
    const corps = req.postData() ?? "";
    envois.push({ octets: corps.length, delta: corps.startsWith('{"delta"'), statut: null, req });
  }
});
page.on("response", (res) => {
  const envoi = envois.find((e) => e.req === res.request());
  if (envoi) envoi.statut = res.status();
});

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/notes/")[1].split(/[?#]/)[0];
await page.getByLabel("Titre de la note").fill(`Long document ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(1200);
const blockId = sql(`select id from NoteBlock where noteId = '${noteId}' and kind = 'drawing' limit 1;`);

const TRAITS = 5000;
const lourd = documentLourd(30, TRAITS);
poserEnBase(blockId, lourd);
const poids = Number(sql(`select length(content) from NoteBlock where id = '${blockId}';`));
dire("document posé en base", `30 pages, ${TRAITS} traits, ${(poids / 1e6).toFixed(1)} Mo`);

const libelle = () => page.locator('[data-testid="drawing-canvas"]').last().getAttribute("aria-label");
await page.reload({ waitUntil: "networkidle" });
await page
  .waitForFunction(
    (n) => document.querySelector('[data-testid="drawing-canvas"]')?.getAttribute("aria-label")?.includes(`${n} traits`),
    TRAITS,
    { timeout: 30000 },
  )
  .catch(() => {});
check(
  (await libelle())?.includes(`${TRAITS} traits`),
  `les ${TRAITS} traits s'ouvrent — au-delà des quatre mille d'autrefois`,
  await libelle(),
);

/** Un trait au stylet dans la partie visible de la page. */
async function tracer(decalage) {
  await page.evaluate(async (decalage) => {
    const el = document.querySelector('[data-testid="drawing-canvas"]');
    const r = el.getBoundingClientRect();
    const haut = Math.max(r.top, 0) + 120 + decalage;
    const fire = (type, x, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen",
          isPrimary: true, pressure: 0.6, buttons,
          clientX: r.left + r.width * x, clientY: haut,
        }),
      );
    fire("pointerdown", 0.2, 1);
    for (let i = 1; i <= 24; i++) {
      fire("pointermove", 0.2 + i * 0.02, 1);
      await new Promise((ok) => setTimeout(ok, 5));
    }
    fire("pointerup", 0.68, 0);
  }, decalage);
}

/** Attend que tous les envois partis aient leur réponse, puis un temps de repos. */
async function attendreEnvois(n, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (envois.length >= n && envois.every((e) => e.statut !== null)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

// Mesure du fil principal pendant l'enregistrement : rien n'est ajouté à l'app.
await page.evaluate(() => {
  window.__longues = [];
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) window.__longues.push(Math.round(e.duration));
  }).observe({ type: "longtask", buffered: false });
});

// =============================================================================
section("un trait de plus ne fait voyager que lui");

await tracer(0);
check(await attendreEnvois(1), "l'enregistrement part et revient", JSON.stringify(envois.map((e) => e.statut)));
const premier = envois[0];
dire("premier envoi", `${premier?.octets} octets, ${premier?.delta ? "morceau" : "complet"}, HTTP ${premier?.statut}`);
check(premier?.statut === 200, "le serveur l'accepte", `HTTP ${premier?.statut}`);
check(premier?.delta === true, "c'est un morceau, pas le document entier");
check(premier?.octets < 64 * 1024, "qui pèse moins de 64 Ko pour un document de vingt mégaoctets", `${premier?.octets} octets`);

await page.waitForTimeout(400);
await tracer(60);
check(await attendreEnvois(2), "le deuxième trait part aussi");
const second = envois[1];
dire("deuxième envoi", `${second?.octets} octets, ${second?.delta ? "morceau" : "complet"}, HTTP ${second?.statut}`);
check(second?.statut === 200 && second?.delta, "en morceau, sur la version que le serveur vient de confirmer");
const longues = await page.evaluate(() => window.__longues);
dire("tâches longues pendant les deux enregistrements", longues.length ? `${longues.join(", ")} ms` : "aucune");

// =============================================================================
section("tout est là au rechargement");

const enBase = contenuEnBase(blockId);
check(enBase.strokes.length === TRAITS + 2, `la base garde ${TRAITS + 2} traits`, `${enBase.strokes.length}`);
check(enBase.pages.length === 30, "et ses trente pages", `${enBase.pages.length}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check((await libelle())?.includes(`${TRAITS + 2} traits`), "et la page les montre tous", await libelle());

// =============================================================================
section("la base a bougé derrière l'onglet");

// Un autre appareil a écrit : la version du serveur n'est plus celle de l'onglet.
const ailleurs = contenuEnBase(blockId);
ailleurs.strokes.push({ ...ailleurs.strokes[0], color: "red" });
poserEnBase(blockId, ailleurs);
const avantConflit = envois.length;
await tracer(120);
check(await attendreEnvois(avantConflit + 2, 40000), "deux envois : le morceau, puis le document entier");
const conflit = envois.slice(avantConflit);
dire(
  "envois",
  conflit.map((e) => `${e.delta ? "morceau" : "complet"} ${(e.octets / 1e6).toFixed(2)} Mo → ${e.statut}`).join(", "),
);
check(conflit[0]?.delta && conflit[0]?.statut === 409, "le morceau est refusé : il ne part plus de la même version");
check(!conflit[1]?.delta && conflit[1]?.statut === 200, "le document entier est renvoyé et accepté", `HTTP ${conflit[1]?.statut}`);
check(conflit[1]?.octets > 10 * 1024 * 1024, "un envoi de plus de dix mégaoctets, que le proxy laisse passer entier");
const final = contenuEnBase(blockId);
check(final.strokes.length === TRAITS + 3, "la base porte la version de l'onglet, trait neuf compris", `${final.strokes.length}`);

// Ménage : la note d'essai ne reste pas dans la base de vérification.
sql(`delete from Note where id = '${noteId}';`);
try {
  execFileSync("rm", ["-f", TMP]);
} catch {}

await browser.close();
console.log(ko === 0 ? "\nLong document : tout s'enregistre." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
