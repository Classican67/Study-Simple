/*
 * Ajouter un document — PDF ou Word — à une note déjà commencée.
 *
 * Le bouton de la barre d'outils n'acceptait que des images : dans le
 * sélecteur, PDF et documents Word étaient grisés, et le bouton « Document » du
 * bas de la note en faisait une page à part, absente du plein écran. Un
 * document choisi depuis la barre devient maintenant des pages, juste après la
 * page courante, sans créer de bloc ; Annuler les retire, et leur fichier avec.
 *
 * La conversion d'un document Word demande LibreOffice : elle se vérifie sur
 * l'image Docker, pas sur une machine qui ne l'a pas. Le chemin est le même
 * qu'un PDF passé la conversion.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const AJOUTER = "Ajouter une photo, une image ou un document";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();
const genres = (c) => c.pages.map((p) => ("file" in p ? "document" : "image" in p ? "image" : "blank"));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => check(false, "aucune erreur de page", String(e).slice(0, 160)));

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+$/);
const noteId = page.url().split("/").pop();
await page.getByLabel("Titre de la note").fill(`Document ajouté ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.locator('[data-testid="drawing-canvas"]').first().waitFor();
const blockId = sql(`select id from NoteBlock where noteId='${noteId}';`);
const lire = () => JSON.parse(sql(`select content from NoteBlock where id='${blockId}';`));
const blocs = () => Number(sql(`select count(*) from NoteBlock where noteId='${noteId}';`));

/** Attend que l'enregistrement en base satisfasse la condition. */
async function enBase(condition, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const c = lire();
    if (condition(c)) return c;
    await attendre(300);
  }
  return lire();
}

async function ajouter(racine, fichier) {
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(`${racine} [role="toolbar"] button[aria-label="${AJOUTER}"]`).first().click(),
  ]);
  await selecteur.setFiles(fichier);
}

// --- En ligne -----------------------------------------------------------------
section("en ligne, sur une page manuscrite");
const accept = await page.locator("input[data-page-image]").first().getAttribute("accept");
check(accept.includes("image/*") && accept.includes(".pdf") && accept.includes(".docx"), "le sélecteur propose images, PDF et Word", accept);

await ajouter("section", "doc-test.pdf");
const apres = await enBase((c) => c.pages.length >= 3);
check(
  JSON.stringify(genres(apres)) === JSON.stringify(["blank", "document", "document"]),
  "le PDF devient ses pages, après la page courante",
  JSON.stringify(genres(apres)),
);
const fichier = apres.pages.find((p) => "file" in p)?.file;
check(apres.pages.filter((p) => "file" in p).every((p, i) => p.file === fichier && p.page === i + 1), "les pages suivent l'ordre du document");
check(Boolean(fichier) && existsSync(`uploads/${fichier}`), "le fichier est enregistré", fichier);
check(blocs() === 1, "aucun bloc n'est créé à côté", `${blocs()} blocs`);
await page.waitForTimeout(800);
check(!(await page.getByRole("status").filter({ hasText: "document" }).count()), "le suivi d'envoi disparaît une fois les pages posées");
check(
  (await page.locator('section canvas[aria-label$="du document importé"]').count()) > 0,
  "les pages du document s'affichent",
);

await page.locator('section [role="toolbar"] button[aria-label="Annuler"]').click();
const annule = await enBase((c) => c.pages.length === 0);
check(annule.pages.length === 0, "Annuler retire toutes les pages du document d'un coup", JSON.stringify(genres(annule)));
let parti = false;
for (let i = 0; i < 30 && !parti; i++) {
  await attendre(300);
  parti = !existsSync(`uploads/${fichier}`);
}
check(parti, "et le fichier ne reste pas sur le disque");

// --- Plein écran --------------------------------------------------------------
section("en plein écran");
await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
await page.waitForTimeout(600);
await ajouter(".ink-surface.fixed", "doc-test.pdf");
const plein = await enBase((c) => c.pages.length >= 3);
check(
  JSON.stringify(genres(plein)) === JSON.stringify(["blank", "document", "document"]),
  "le bouton de la barre fait la même chose en plein écran",
  JSON.stringify(genres(plein)),
);
await page.keyboard.press("Escape");

// --- Refus --------------------------------------------------------------------
section("un faux PDF");
const avantRefus = lire();
const fichiersAvant = readFileSyncDir();
writeFileSync("_faux.pdf", "Ceci n'est pas un PDF.");
await ajouter("section", "_faux.pdf");
await page.getByRole("alert").filter({ hasText: "PDF" }).waitFor({ timeout: 15000 }).catch(() => {});
check(
  (await page.getByRole("alert").filter({ hasText: "PDF" }).count()) > 0,
  "est refusé avec un message",
);
await page.waitForTimeout(1200);
check(lire().pages.length === avantRefus.pages.length, "sans toucher aux pages");
check(readFileSyncDir() === fichiersAvant, "et sans laisser de fichier sur le disque");
rmSync("_faux.pdf", { force: true });

function readFileSyncDir() {
  return execFileSync("ls", ["uploads"]).toString().trim().split("\n").length;
}

// Ménage : la suppression de la note emporte ses fichiers.
await page.getByRole("button", { name: "Supprimer la note" }).click();
await page.getByRole("button", { name: "Supprimer", exact: true }).click();
await page.waitForURL(/\/notes(\?|$)/);

await browser.close();
console.log(ko === 0 ? "\nUn document s'ajoute aux pages d'une note commencée." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
