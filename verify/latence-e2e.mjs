/*
 * Ce qui se passe **entre deux lettres**.
 *
 * Écrire, c'est lever et reposer la pointe dix fois par seconde. Tout ce que l'app
 * fait au lever — repeindre, enregistrer, relancer React — se paie sur le poser
 * suivant : le fil principal est occupé, et le début de la lettre arrive en retard,
 * ou pas du tout. Aucun script ne le voyait, parce qu'aucun ne levait la pointe
 * aussi vite sur une page aussi pleine, sur un processeur aussi lent qu'une tablette.
 *
 * Page de trois mille traits, processeur ralenti quatre fois, cinquante traits
 * espacés de quatre-vingts millisecondes : le rythme d'une écriture courante.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const SEUIL = Number(process.env.SEUIL_MS ?? 0);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("erreur page :", String(e).slice(0, 200)));

const base = new DatabaseSync("verif.db", { timeout: 4000 });
const TITRE = `Latence ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(TITRE);
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(800);
const noteId = page.url().split("/").at(-1);

const traits = [];
for (let i = 0; i < 3000; i++) {
  const x0 = 0.03 + (i % 60) * 0.0155;
  const y0 = 0.03 + Math.floor(i / 60) * 0.024;
  const points = [];
  for (let k = 0; k < 40; k++) {
    points.push(+(x0 + (k / 40) * 0.012).toFixed(4), +(y0 + 0.006 * Math.sin(k / 3)).toFixed(4), 0.5);
  }
  traits.push({ color: "default", size: 2.5, tool: "pen", points });
}
base.prepare("UPDATE NoteBlock SET content = ? WHERE noteId = ?").run(
  JSON.stringify({ strokes: traits, ratio: 1.4, paper: "blank", pages: [], images: [] }),
  noteId,
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const resultat = await page.locator('[data-testid="drawing-canvas"]').first().evaluate(async (el) => {
  const taches = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) taches.push(e.duration);
  }).observe({ entryTypes: ["longtask"] });

  const r = el.getBoundingClientRect();
  // Le retard du poser : ce qui sépare le moment où la pointe touche du moment où
  // la page peut le traiter. On le lit en reprenant la main juste avant d'émettre.
  const retards = [];
  const attendre = (ms) => new Promise((f) => setTimeout(f, ms));
  const f = (t, x, y, p, b) =>
    el.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
      pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.height * y,
    }));
  for (let n = 0; n < 50; n++) {
    const y = 0.2 + (n % 8) * 0.08;
    const x = 0.1 + (n % 20) * 0.04;
    const prevu = performance.now() + 80;
    await attendre(80);
    // Retard d'une horloge posée à quatre-vingts millisecondes : c'est le temps que
    // le fil principal a mis à se libérer, donc celui qu'un `pointerdown` attendrait.
    retards.push(Math.max(0, performance.now() - prevu));
    f("pointerdown", x, y, 0.5, 1);
    for (let i = 1; i < 10; i++) {
      await attendre(8);
      f("pointermove", x + i * 0.004, y + 0.002 * Math.sin(i), 0.45, 1);
    }
    f("pointerup", x + 0.04, y, 0, 0);
  }
  await attendre(600);
  retards.sort((a, b) => a - b);
  return {
    p50: retards[Math.floor(retards.length * 0.5)],
    p95: retards[Math.floor(retards.length * 0.95)],
    max: retards.at(-1),
    longues: taches.length,
    plusLongue: Math.max(0, ...taches),
    cumul: taches.reduce((a, b) => a + b, 0),
  };
});
await page.waitForTimeout(1500);
const f = (n) => `${Math.round(n)} ms`;
console.log(`retard d'un poser : médian ${f(resultat.p50)}, p95 ${f(resultat.p95)}, pire ${f(resultat.max)}`);
console.log(`tâches longues : ${resultat.longues}, la plus longue ${f(resultat.plusLongue)}, cumul ${f(resultat.cumul)}`);
const enBase = JSON.parse(base.prepare("SELECT content FROM NoteBlock WHERE noteId = ?").get(noteId).content).strokes.length;
console.log(`traits en base : ${enBase - 3000} sur 50`);
base.prepare("DELETE FROM Note WHERE id = ?").run(noteId);
await browser.close();
const ko = enBase - 3000 !== 50 || (SEUIL > 0 && resultat.p95 > SEUIL);
console.log(ko ? "échec" : "Tout passe.");
process.exit(ko ? 1 : 0);
