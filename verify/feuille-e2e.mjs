/*
 * Une note, une feuille, ouverte tout de suite en plein écran.
 *
 * Et les notes d'avant restent ce qu'elles étaient : c'est la moitié de la demande,
 * et celle qu'une migration casse sans bruit. La note « ancienne » est donc posée
 * en base sous sa forme d'origine, sans passer par l'app.
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
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});
const base = new DatabaseSync("verif.db", { timeout: 3000 });
const TITRE = `Feuille ${Date.now()}`;

async function trait(p) {
  await p.locator('[data-testid="drawing-canvas"]').first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, pr, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
        pressure: pr, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.height * 0.3,
      }));
    f("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", 0.2 + i * 0.03, 0.45, 1);
    f("pointerup", 0.6, 0, 0);
  });
  await p.waitForTimeout(200);
}

try {
  console.log("— une note neuve");
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(500);
  const url = page.url();
  const noteId = url.split("/").at(-1);

  const m = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="drawing-canvas"]').getBoundingClientRect();
    const barre = document.querySelector("nav[aria-label='Navigation principale']");
    return {
      largeur: canvas.width,
      bas: canvas.bottom,
      fenetre: [innerWidth, innerHeight],
      // La navigation de l'app est sous la feuille : aucun de ses liens ne reçoit de pointeur.
      appBar: [...document.querySelectorAll("nav[aria-label='Navigation principale'] a")].some((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === a;
      }),
      navVisible: barre ? barre.getBoundingClientRect().width > 0 : false,
      debordeLaPage: document.documentElement.scrollHeight - innerHeight,
    };
  });
  check(Math.abs(m.largeur - m.fenetre[0]) <= 16, "la feuille prend toute la largeur dès l'ouverture", `${m.largeur} sur ${m.fenetre[0]}`);
  check(m.bas >= m.fenetre[1] - 1, "et va jusqu'en bas de l'écran", `bas à ${m.bas} sur ${m.fenetre[1]}`);
  check(!m.appBar, "la barre de l'app n'est pas par-dessus");

  check((await page.getByRole("button", { name: "Quitter le plein écran" }).count()) === 0, "il n'y a pas de plein écran à quitter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check((await page.getByRole("link", { name: "Revenir aux notes" }).count()) === 1, "Échap ne la replie pas : le retour est le bouton de retour");
  for (const nom of ["Texte", "Tableau", "Croquis"]) {
    check((await page.getByRole("button", { name: nom, exact: true }).count()) === 0, `pas de bouton « ${nom} » : une note n'a qu'une feuille`);
  }
  check((await page.locator('section[aria-label^="Bloc"]').count()) === 0, "aucun cadre de bloc");

  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForTimeout(400);

  await trait(page);
  await page.waitForTimeout(1300);
  const note = base.prepare("SELECT id, title, format FROM Note WHERE id = ?").get(noteId);
  check(note.format === "feuille" && note.title === TITRE, "elle est enregistrée comme une feuille, avec son titre");
  const blocs = base.prepare("SELECT content FROM NoteBlock WHERE noteId = ?").all(noteId);
  check(blocs.length === 1 && JSON.parse(blocs[0].content).strokes.length === 1, "un seul bloc, et le trait y est");

  await page.getByRole("button", { name: "Ajouter une page après celle-ci" }).first().click();
  await page.waitForTimeout(1200);
  const pile = JSON.parse(base.prepare("SELECT content FROM NoteBlock WHERE noteId = ?").get(noteId).content);
  check(pile.pages.length === 2, "elle grandit par pages, pas par documents");

  await page.getByRole("button", { name: "Actions de la note" }).first().click();
  check(await page.getByRole("button", { name: "Maîtrisée" }).isVisible(), "les actions de la note sont là");
  await page.mouse.click(300, 400);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  check((await page.getByRole("link", { name: "Revenir aux notes" }).count()) === 1, "rouverte, elle s'ouvre encore en plein écran");

  await page.evaluate(async () => navigator.clipboard?.writeText?.("x").catch(() => {}));
  await page.getByRole("link", { name: "Revenir aux notes" }).click();
  await page.waitForURL(/\/notes(\?|$)/);
  check(true, "le retour ramène à la liste");

  console.log("— une note d'avant la mise à jour");
  const ancienne = `ancienne${Date.now()}`;
  const maintenant = Date.now();
  const proprietaire = base.prepare("SELECT ownerId FROM Note WHERE id = ?").get(noteId).ownerId;
  base.prepare("INSERT INTO Note (id, ownerId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(ancienne, proprietaire, `Ancienne ${maintenant}`, maintenant, maintenant);
  base.prepare("INSERT INTO NoteBlock (id, noteId, kind, position, content) VALUES (?, ?, 'text', 0, ?)").run(`${ancienne}a`, ancienne, JSON.stringify({ style: "p", markup: "Du texte d'avant" }));
  base.prepare("INSERT INTO NoteBlock (id, noteId, kind, position, content) VALUES (?, ?, 'drawing', 1, ?)").run(`${ancienne}b`, ancienne, JSON.stringify({ strokes: [], ratio: 0.75, paper: "blank", pages: [] }));
  const lue = base.prepare("SELECT format FROM Note WHERE id = ?").get(ancienne);
  check(lue.format === "blocs", "une note existante garde la forme « blocs » par défaut de colonne");

  await page.goto(`${BASE}/notes/${ancienne}`, { waitUntil: "networkidle" });
  check((await page.locator('section[aria-label^="Bloc"]').count()) === 2, "ses deux blocs sont là, comme avant");
  check((await page.getByText("Du texte d'avant").count()) >= 0 && (await page.getByRole("button", { name: "Texte", exact: true }).count()) > 0, "et l'on peut encore y ajouter des blocs");
  check((await page.getByRole("button", { name: "Écrire en plein écran" }).count()) > 0, "son plein écran reste à la demande");
  base.prepare("DELETE FROM Note WHERE id = ?").run(ancienne);

  console.log("— mesures de l'en-tête");
  for (const schema of ["light", "dark"]) {
    for (const [nom, w, h] of [["téléphone", 393, 852], ["desktop", 1280, 900]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await c2.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      const p = await c2.newPage();
      await p.goto(url, { waitUntil: "networkidle" });
      await p.evaluate((s) => document.documentElement.classList.toggle("dark", s === "dark"), schema);
      await p.waitForTimeout(250);
      await p.getByRole("button", { name: "Actions de la note" }).first().click();
      const petits = await p.evaluate(() =>
        [...document.querySelectorAll('[role="group"][aria-label="Actions de la note"] button, header button, header a')]
          .map((el) => ({ n: el.getAttribute("aria-label") ?? el.textContent, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
          .map(({ n, r }) => `${n} ${Math.round(r.width)}×${Math.round(r.height)}`),
      );
      check(petits.length === 0, `cibles de 44 px — ${nom}, ${schema}`, petits.join(", "));
      const contraste = await p.evaluate(CONTRAST);
      check(contraste.length === 0, `contraste — ${nom}, ${schema}`, JSON.stringify(contraste.slice(0, 2)));
      const debord = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(debord <= 1, `pas de débordement — ${nom}, ${schema}`, `${debord} px`);
      await p.screenshot({ path: `shots/feuille-${nom}-${schema}.png` });
      await c2.close();
    }
  }
} catch (e) {
  console.log("❌ arrêt :", e);
  echecs++;
}
await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
