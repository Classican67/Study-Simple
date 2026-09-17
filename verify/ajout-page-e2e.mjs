/*
 * « Ajouter une page » sur une surface qui n'est pas encore une pile.
 *
 * Une page manuscrite neuve a `pages: []` : ce n'est pas une pile, c'est une
 * feuille. `insertPage` rendait alors le contenu inchangé et la palette masquait
 * le bouton — donc la page sur laquelle s'ouvre **chaque note neuve** ne pouvait
 * pas grandir, pas plus qu'un croquis ajouté à la main. C'est le défaut
 * rapporté : « si je fais un croquis simple je ne peux pas rajouter une page ».
 *
 * Et la feuille qu'on ajoute après une photo doit être une feuille : elle
 * reprenait le format du cliché, si bien qu'après une photo en paysage on
 * écrivait sur une bande deux fois plus large que haute.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 950 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 160));
  echecs++;
});

const TITRE = `Ajout page ${Date.now()}`;
const AJOUTER = "Ajouter une page après celle-ci";
const canvas = () => page.locator('[data-testid="drawing-canvas"]');

/*
 * Les pages telles que le serveur les a **écrites**, lues dans la base du bac à
 * sable. La hauteur du canevas ne dirait rien : la fenêtre d'une page manuscrite
 * est bornée à l'écran, et c'est la surface qui défile dedans.
 */
const base = new DatabaseSync("verif.db");
function pagesEnBase(titre) {
  const note = base
    .prepare("SELECT id FROM Note WHERE title = ? ORDER BY createdAt DESC LIMIT 1")
    .get(titre);
  if (!note) return [];
  return base
    .prepare("SELECT content FROM NoteBlock WHERE noteId = ? ORDER BY position")
    .all(note.id)
    .map((b) => JSON.parse(b.content).pages);
}

/** Le format de la pile telle qu'elle défile : hauteur totale sur largeur. */
async function formatDeLaPile(index = 0) {
  return page.locator("[data-ink-scroll]").nth(index).evaluate(
    (el) => el.scrollHeight / el.clientWidth,
  );
}

/** Un trait au stylet, pour être dans le cas « j'ai commencé mon croquis ». */
async function trait(y) {
  await canvas().first().evaluate((el, yy) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, p, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
        pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * yy,
      }));
    f("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", 0.2 + i * 0.035, 0.45, 1);
    f("pointerup", 0.7, 0, 0);
  }, y);
  await page.waitForTimeout(200);
}

try {
  // --- 1. Une note neuve : sa page doit pouvoir grandir ---------------------
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  const url = page.url();
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(600);

  check(
    (await page.getByRole("button", { name: AJOUTER }).count()) === 1,
    "la page d'une note neuve propose d'ajouter une feuille",
  );

  await page.getByRole("button", { name: "Stylo" }).click();
  await trait(0.12);
  await page.waitForTimeout(1500);

  const avant = await formatDeLaPile();
  await page.getByRole("button", { name: AJOUTER }).first().click();
  await page.waitForTimeout(2000);
  const apres = await formatDeLaPile();

  check(
    apres > avant * 1.6,
    "la pile grandit d'une page entière",
    `format ${avant.toFixed(2)} → ${apres.toFixed(2)}`,
  );
  check(
    (await canvas().first().getAttribute("aria-label"))?.includes("1 trait"),
    "et le trait déjà posé ne bouge pas",
    await canvas().first().getAttribute("aria-label"),
  );
  check(
    (await page.getByRole("button", { name: "Supprimer cette page ajoutée" }).count()) === 1,
    "la feuille ajoutée se retire",
  );

  // --- 2. Enregistré, et toujours là après rechargement --------------------
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const enregistrees = pagesEnBase(TITRE);
  check(
    enregistrees[0]?.length === 2,
    "les deux pages sont enregistrées",
    JSON.stringify(enregistrees[0] ?? null),
  );
  check(
    (await formatDeLaPile()) > avant * 1.6,
    "et la deuxième page survit au rechargement",
    (await formatDeLaPile()).toFixed(2),
  );

  // --- 3. Une feuille après une photo est une feuille, pas un cliché -------
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Photo", exact: true }).click(),
  ]);
  await chooser.setFiles("photo.png");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Utiliser" }).click();
  await page.waitForTimeout(3500);

  const blocPhoto = canvas().last();
  const formatPhoto = await blocPhoto.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.height / r.width;
  });
  check(formatPhoto < 0.9, "la photo d'essai est bien en paysage", formatPhoto.toFixed(3));

  await blocPhoto.scrollIntoViewIfNeeded();
  const palettePhoto = page.getByRole("toolbar").last();
  await palettePhoto.getByRole("button", { name: AJOUTER }).click();
  await page.waitForTimeout(2500);

  await page.waitForTimeout(1500);
  const pagesPhoto = pagesEnBase(TITRE).at(-1) ?? [];
  const feuille = pagesPhoto[1];
  check(
    pagesPhoto.length === 2 && feuille !== undefined,
    "la feuille est bien ajoutée après la photo",
    JSON.stringify(pagesPhoto),
  );
  check(
    feuille !== undefined && Math.abs(feuille.ratio - 0.75) < 0.001,
    "et elle a la forme d'une feuille, pas celle du cliché",
    `${feuille?.ratio} — la photo fait ${pagesPhoto[0]?.ratio}`,
  );
} catch (cause) {
  console.log(`❌ le script s'est interrompu — ${String(cause).slice(0, 200)}`);
  echecs++;
}

// --- Ménage -----------------------------------------------------------------
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const carte = page.locator(`text=${TITRE}`).first();
if (await carte.count()) {
  await carte.click({ button: "right" });
  const supprimer = page.getByRole("menuitem", { name: /Supprimer/ });
  if (await supprimer.count()) {
    await supprimer.click();
    const ok = page.getByRole("button", { name: "Supprimer", exact: true });
    if (await ok.count()) await ok.click();
    await page.waitForTimeout(800);
  }
}
check((await page.locator(`text=${TITRE}`).count()) === 0, "la note d'essai ne reste pas dans la base");

await browser.close();
console.log(echecs === 0 ? "\n✅ une page s'ajoute partout" : `\n❌ ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
