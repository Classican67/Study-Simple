/*
 * Ce qui sert à apprendre : les caches de révision, la carte tirée d'une note, le
 * bilan et les actions rapides.
 *
 * Le bilan se vérifie sur des réponses posées en base, à des dates connues : une
 * série ne se mesure pas autrement.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CONTRAST } from "./sondes.mjs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});
const base = new DatabaseSync("verif.db", { timeout: 3000 });
const TITRE = `Étude ${Date.now()}`;

async function trait(y, outil) {
  await page.getByRole("button", { name: "Écrire", exact: true }).first().click();
  await page.getByRole("button", { name: outil, exact: true }).first().click();
  await page.locator('[data-testid="drawing-canvas"]').first().evaluate((el, yy) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, p, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
        pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.height * yy,
      }));
    f("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", 0.2 + i * 0.03, 0.45, 1);
    f("pointerup", 0.6, 0, 0);
  }, y);
  await page.waitForTimeout(200);
}

const pixels = (y) =>
  page.evaluate((yy) => {
    const s = document.querySelector('[data-testid="drawing-canvas"]').getBoundingClientRect();
    return document.elementFromPoint(s.left + s.width * 0.4, s.top + s.height * yy)?.tagName;
  }, y);
void pixels;

const cacheAffiche = () => page.locator('[data-masque="cache"]').count();

try {
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(500);
  const noteId = page.url().split("/").at(-1);

  console.log("— caches de révision");
  const LABEL = "Cacher le surligné pour réviser";
  check((await page.getByRole("button", { name: LABEL }).count()) === 0, "rien de surligné, rien à cacher");
  await trait(0.2, "Stylo");
  await trait(0.3, "Surligneur");
  await trait(0.5, "Surligneur");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: LABEL }).first().click();
  await page.waitForSelector("[data-masques]");
  check((await cacheAffiche()) === 2, "chaque surlignage devient un cache", String(await cacheAffiche()));
  const opaque = await page.locator('[data-masque="cache"]').first().evaluate((p) => getComputedStyle(p).opacity);
  check(opaque === "1", "et il est opaque", opaque);

  const b = await page.locator('[data-testid="drawing-canvas"]').first().boundingBox();
  await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.3);
  await page.waitForTimeout(150);
  check((await cacheAffiche()) === 1, "le toucher révèle ce cache-là");
  await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.3);
  await page.waitForTimeout(150);
  check((await cacheAffiche()) === 2, "le toucher à nouveau le recache");
  await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.8);
  await page.waitForTimeout(150);
  check((await cacheAffiche()) === 2, "toucher ailleurs ne fait rien");

  const traits = () =>
    JSON.parse(base.prepare("SELECT content FROM NoteBlock WHERE noteId = ?").get(noteId).content).strokes.length;
  const avant = traits();
  await page.mouse.move(b.x + 300, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 350, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  check(traits() === avant, "pendant la révision, rien ne s'écrit");

  await page.getByRole("button", { name: "Révéler le suivant" }).first().click();
  await page.waitForTimeout(100);
  check((await cacheAffiche()) === 1, "« Révéler le suivant » suit l'ordre de lecture");
  check((await page.getByText("1/2").count()) > 0, "et compte");
  await page.screenshot({ path: "shots/caches-revision.png" });
  await page.getByRole("button", { name: "Tout révéler" }).first().click();
  await page.waitForTimeout(100);
  check((await cacheAffiche()) === 0, "« Tout révéler »");
  await page.getByRole("button", { name: "Quitter la révision" }).first().click();
  check((await page.locator("[data-masques]").count()) === 0, "quitter range les caches");

  console.log("— une carte depuis la note");
  const paquet = base.prepare("SELECT id, title FROM Deck LIMIT 1").get();
  const cartesAvant = base.prepare("SELECT count(*) AS n FROM Card WHERE deckId = ?").get(paquet.id).n;
  await page.getByRole("button", { name: "Lasso", exact: true }).first().click();
  // Sous la pilule de réglages, qui flotte en haut de la page.
  const hautLasso = b.height * 0.14;
  await page.mouse.move(b.x + 80, b.y + hautLasso);
  await page.mouse.down();
  for (const [x, y] of [[b.width - 80, hautLasso], [b.width - 80, b.height * 0.42], [80, b.height * 0.42], [80, hautLasso]]) {
    await page.mouse.move(b.x + x, b.y + y, { steps: 5 });
  }
  await page.mouse.up();
  await page.locator('[data-testid="cadre-selection"]').waitFor();
  await page.getByRole("button", { name: "Créer une carte" }).click();
  await page.getByRole("dialog", { name: "Créer une carte" }).waitFor();
  await page.waitForSelector("[data-carte-apercu]");
  const dims = await page.locator("[data-carte-apercu]").evaluate((i) => [i.naturalWidth, i.naturalHeight]);
  check(dims[0] > 300 && dims[1] > 50, "la zone entourée est capturée", dims.join("×"));
  await page.waitForFunction(() => document.querySelector("select")?.value);
  await page.locator("select").selectOption(paquet.id);
  const question = `Que montre ce schéma ${Date.now()} ?`;
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Créer la carte" }).click();
  await page.getByText("Carte créée").waitFor({ timeout: 5000 });
  const carte = base.prepare("SELECT term, definition, imagePath FROM Card WHERE deckId = ? ORDER BY createdAt DESC LIMIT 1").get(paquet.id);
  check(base.prepare("SELECT count(*) AS n FROM Card WHERE deckId = ?").get(paquet.id).n === cartesAvant + 1 && carte.term === question, "la carte est dans le paquet");
  check(Boolean(carte.imagePath), "avec son image", carte.imagePath ?? "");
  check(carte.definition === "Voir l'image.", "la réponse écrite reste facultative");
  base.prepare("DELETE FROM Card WHERE term = ?").run(question);

  console.log("— le bilan");
  const proprietaire = base.prepare("SELECT ownerId FROM Note WHERE id = ?").get(noteId).ownerId;
  const carteId = base.prepare("SELECT c.id FROM Card c JOIN Deck d ON d.id = c.deckId WHERE d.ownerId = ? LIMIT 1").get(proprietaire).id;
  const jour = 86400000;
  const midi = new Date();
  midi.setHours(12, 0, 0, 0);
  const ajout = base.prepare("INSERT INTO ReviewAnswer (id, userId, cardId, knew, answeredAt, receivedAt) VALUES (?, ?, ?, ?, ?, ?)");
  const id = Date.now();
  // Trois jours d'affilée jusqu'à aujourd'hui : huit réponses, six justes.
  for (let i = 0; i < 8; i++) {
    ajout.run(`e2e${id}${i}`, proprietaire, carteId, i < 6 ? 1 : 0, midi.getTime() - (i % 3) * jour, midi.getTime());
  }
  await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
  const serie = await page.locator("section[aria-label='En bref'] > div").first().textContent();
  check(/[3-9]\s*jours|\d\d\s*jours/.test(serie), "la série compte les jours d'affilée", serie);
  const cases = await page.locator("[data-niveau]").count();
  check(cases > 150, "la carte de régularité est dessinée", `${cases} cases`);
  const allumees = await page.locator('[data-niveau]:not([data-niveau="0"])').count();
  check(allumees >= 3, "les jours de révision y sont allumés", String(allumees));
  await page.locator('[data-niveau]:not([data-niveau="0"])').last().hover();
  const bulle = await page.locator('[role="status"]').first().textContent();
  check(/réponse/.test(bulle), "le survol donne le détail", bulle);

  for (const schema of ["light", "dark"]) {
    for (const [nom, w, h] of [["téléphone", 393, 852], ["desktop", 1280, 900]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await c2.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      const p = await c2.newPage();
      await p.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
      await p.evaluate((s) => document.documentElement.classList.toggle("dark", s === "dark"), schema);
      await p.waitForTimeout(250);
      const contraste = await p.evaluate(CONTRAST);
      check(contraste.length === 0, `bilan : contraste — ${nom}, ${schema}`, JSON.stringify(contraste.slice(0, 2)));
      const debord = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(debord <= 1, `bilan : pas de débordement — ${nom}, ${schema}`, `${debord} px`);
      await p.screenshot({ path: `shots/bilan-${nom}-${schema}.png`, fullPage: true });
      await c2.close();
    }
  }
  base.prepare("DELETE FROM ReviewAnswer WHERE id LIKE ?").run(`e2e${id}%`);

  console.log("— actions rapides");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.keyboard.press("ControlOrMeta+k");
  const champ = page.getByRole("searchbox", { name: "Rechercher" });
  await champ.waitFor();
  check((await page.getByRole("option", { name: "Nouvelle note" }).count()) === 1, "les actions sont là avant de taper");
  await champ.fill("bilan");
  await page.waitForTimeout(150);
  check((await page.getByRole("option", { name: "Voir le bilan" }).count()) === 1, "elles se filtrent en tapant");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/stats/);
  check(true, "Entrée y mène");

  console.log("— reprise de lecture");
  await page.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.getByRole("button", { name: "Ajouter une page après celle-ci" }).first().click();
  await page.waitForTimeout(900);
  await page.locator("[data-ink-scroll]").evaluate((s) => {
    s.scrollTop = 500;
  });
  await page.waitForTimeout(900);
  const relu = await page.locator("[data-ink-scroll]").evaluate((s) => s.scrollTop);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(400);
  const repris = await page.locator("[data-ink-scroll]").evaluate((s) => s.scrollTop);
  check(Math.abs(repris - relu) < 8, "la note se rouvre où on l'avait laissée", `${Math.round(repris)} pour ${Math.round(relu)}`);
} catch (e) {
  console.log("❌ arrêt :", e);
  echecs++;
}
await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
