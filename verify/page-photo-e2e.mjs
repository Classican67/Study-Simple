/*
 * Une photo ou une image, ajoutée depuis la barre d'outils, devient une page.
 *
 * Sur une page manuscrite simple, sur une pile qui porte déjà des photos, et sur
 * un document importé : l'image se glisse après la page courante, les
 * annotations qui suivent descendent avec leur page, et Annuler la retire —
 * fichier compris. Les vérifications lisent le contenu **enregistré** en base,
 * pas l'interface : c'est lui qui dit où tombe chaque trait.
 *
 * Et une note neuve s'ouvre sur une page manuscrite vierge, pas sur un
 * paragraphe.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const GAP = 0.02; // PAGE_GAP, dans src/lib/notes.ts
const AJOUTER = "Ajouter une photo, une image ou un document";
mkdirSync("shots", { recursive: true });

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}
const section = (titre) => console.log(`\n── ${titre} ──`);

/** Le contenu enregistré de la première page manuscrite d'une note. */
const bloc = (noteId) =>
  JSON.parse(
    execFileSync("sqlite3", [
      "verif.db",
      `select content from NoteBlock where noteId='${noteId}' and kind='drawing' order by position limit 1;`,
    ])
      .toString()
      .trim(),
  );
const genres = (c) => c.pages.map((p) => ("file" in p ? "document" : "image" in p ? "image" : "blank"));
const milieu = (s) => {
  const ys = s.points.filter((_, i) => i % 3 === 1);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
};
/** La page où tombe un trait : par son milieu, comme l'application et l'export. */
const pageDe = (pages, y) => {
  let haut = 0;
  for (let i = 0; i < pages.length; i++) {
    if (y < haut + pages[i].ratio) return i;
    haut += pages[i].ratio + GAP;
  }
  return pages.length - 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();

const surface = () => page.locator("[data-ink-scroll]").first();
const canvas = () => page.locator('[data-testid="drawing-canvas"]').first();

/** Un trait au stylet, à la hauteur `y` (en fraction de largeur) sous le haut visible de la surface. */
async function tracer(y) {
  await canvas().evaluate(async (el, y) => {
    const r = el.getBoundingClientRect();
    const fire = (t, x, p, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: "pen", isPrimary: true,
        pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * y,
      }));
    fire("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 24; i++) {
      fire("pointermove", 0.2 + i * 0.02, 0.45 + Math.sin(i) * 0.1, 1);
      if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", 0.66, 0, 0);
  }, y);
  // L'enregistrement est différé de sept cents millisecondes.
  await page.waitForTimeout(1500);
}

/** Le vrai chemin : le bouton de la barre, le sélecteur de fichier, le recadreur. */
async function ajouter(fichier) {
  const [selecteur] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: AJOUTER }).first().click(),
  ]);
  await selecteur.setFiles(fichier);
  await page.getByRole("button", { name: "Utiliser" }).click();
  await page.waitForFunction(
    (nom) => !document.querySelector(`[role="toolbar"] button[aria-label="${nom}"][disabled]`),
    AJOUTER,
  );
  await page.waitForTimeout(1800);
}

// --- Une note neuve --------------------------------------------------------
section("une note neuve");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/notes/")[1].split(/[?#]/)[0];
await page.getByLabel("Titre de la note").fill(`Photo en page ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await canvas().waitFor();
check(
  (await page.locator('[data-testid="drawing-canvas"]').count()) === 1 &&
    (await page.locator('[aria-label^="Bloc paragraphe"]').count()) === 0,
  "elle s'ouvre sur une page manuscrite vierge, sans paragraphe",
);
check(await page.getByRole("button", { name: AJOUTER }).first().isVisible(), "l'appareil photo est dans la barre d'outils");

// --- Sur une page manuscrite simple ------------------------------------------
section("sur une page manuscrite simple");
await tracer(0.15);
await ajouter("refs/ref-1.png");
let c = bloc(noteId);
check(JSON.stringify(genres(c)) === '["blank","image"]', "la page devient une pile : la page, puis la photo", genres(c).join(", "));
check(c.strokes.length === 1 && pageDe(c.pages, milieu(c.strokes[0])) === 0, "le trait déjà écrit reste sur sa page");
check(Math.abs(c.pages[1].ratio - 849 / 1400) < 0.02, "la photo garde son format", `${c.pages[1].ratio}`);
const premierePhoto = c.pages[1].image;
check(existsSync(`uploads/${premierePhoto}`), "son fichier est enregistré");
const defile = await surface().evaluate((el) => el.scrollTop);
check(defile > 0, "et la surface défile jusqu'à elle", `${Math.round(defile)} px`);

// On écrit sur la photo, qui est sous les yeux.
await tracer(0.1);
c = bloc(noteId);
check(pageDe(c.pages, milieu(c.strokes[1])) === 1, "on écrit sur la photo");

// --- Au milieu d'une pile ----------------------------------------------------
section("au milieu d'une pile");
await surface().evaluate((el) => {
  el.scrollTop = 0;
  el.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(400);
await ajouter("refs/ref-2.png");
c = bloc(noteId);
check(JSON.stringify(genres(c)) === '["blank","image","image"]', "la photo se glisse après la page courante", genres(c).join(", "));
check(c.pages[2].image === premierePhoto, "l'ancienne photo passe après la nouvelle");
check(pageDe(c.pages, milieu(c.strokes[1])) === 2, "et son annotation descend avec elle");
check(pageDe(c.pages, milieu(c.strokes[0])) === 0, "le trait de la première page ne bouge pas");

check(
  (await page.getByRole("group", { name: "Fond de page" }).count()) === 0,
  "sur une photo, la palette ne propose pas de fond de cahier",
);
check(
  (await page.getByRole("button", { name: "Supprimer cette page ajoutée" }).count()) === 1,
  "mais elle permet de retirer la photo",
);

// --- Annuler -----------------------------------------------------------------
section("annuler");
const glissee = c.pages[1].image;
await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
await page.waitForTimeout(2000);
c = bloc(noteId);
check(JSON.stringify(genres(c)) === '["blank","image"]', "Annuler retire la photo glissée", genres(c).join(", "));
check(pageDe(c.pages, milieu(c.strokes[1])) === 1, "l'annotation remonte sur sa photo");
check(!existsSync(`uploads/${glissee}`), "et le fichier ne reste pas sur le disque");
check(existsSync(`uploads/${premierePhoto}`), "sans toucher à celui de la photo qui reste");

await page.reload({ waitUntil: "networkidle" });
await canvas().waitFor();
await page.waitForTimeout(800);
check(
  (await canvas().getAttribute("aria-label")).includes("2 traits") && (await surface().locator("img").count()) >= 1,
  "tout est là après rechargement",
  await canvas().getAttribute("aria-label"),
);

// --- En plein écran ----------------------------------------------------------
section("en plein écran");
await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
await page.waitForTimeout(800);
const recouvert = await page.evaluate((nom) => {
  const bouton = document.querySelector(`.fixed [role="toolbar"] button[aria-label="${nom}"]`);
  if (!bouton) return "absent";
  const r = bouton.getBoundingClientRect();
  const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return bouton.contains(dessus) ? "" : `recouvert par ${dessus?.tagName}`;
}, AJOUTER);
check(recouvert === "", "l'appareil photo est dans la barre du plein écran, à portée", recouvert);
await page.screenshot({ path: "shots/page-photo-plein-ecran.png" });
await page.keyboard.press("Escape");
await ctx.close();

// --- Sur un document importé -------------------------------------------------
section("sur un document importé");
const docNote = execFileSync("sqlite3", [
  "verif.db",
  `select n.id from NoteBlock b join Note n on n.id=b.noteId where b.kind='drawing' and b.content like '%.pdf"%' order by length(b.content) desc limit 1;`,
])
  .toString()
  .trim();
if (!docNote) {
  check(false, "une note portant un document est nécessaire dans la base de vérification");
} else {
  const ctx2 = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
  await ctx2.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const doc = await ctx2.newPage();
  const avant = bloc(docNote);
  await doc.goto(`${BASE}/notes/${docNote}`, { waitUntil: "networkidle" });
  await doc.locator('[data-testid="drawing-canvas"]').first().waitFor();
  await doc.waitForTimeout(1500);
  const [selecteur] = await Promise.all([
    doc.waitForEvent("filechooser"),
    doc.getByRole("button", { name: AJOUTER }).first().click(),
  ]);
  await selecteur.setFiles("refs/ref-1.png");
  await doc.getByRole("button", { name: "Utiliser" }).click();
  await doc.waitForTimeout(2500);
  const apres = bloc(docNote);
  const g = genres(apres);
  check(
    g.length === avant.pages.length + 1 && g[1] === "image" && g.filter((x) => x === "document").length === genres(avant).filter((x) => x === "document").length,
    "la photo se glisse après la première page du document, sans en perdre une",
    `${genres(avant).length} → ${g.length} pages`,
  );
  // On remet la base de vérification comme elle était.
  await doc.getByRole("button", { name: "Annuler", exact: true }).first().click();
  await doc.waitForTimeout(2000);
  check(bloc(docNote).pages.length === avant.pages.length, "et Annuler rend le document tel qu'il était");
  await ctx2.close();
}

// --- La vignette d'une note neuve où l'on glisse une photo -------------------
section("vignette");
{
  /*
   * Le parcours le plus direct : nouvelle note, rien d'écrit, une photo depuis
   * la barre. La pile commence par la page vierge, sans trait — et la vignette
   * restait blanche, `buildPreview` ne regardant que la première page.
   */
  const ctx3 = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
  await ctx3.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const p3 = await ctx3.newPage();
  const TITRE = `Vignette photo ${Date.now()}`;
  await p3.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await p3.getByRole("button", { name: "Nouvelle note" }).first().click();
  await p3.waitForURL(/\/notes\/[a-z0-9]+/);
  const id3 = p3.url().split("/notes/")[1].split(/[?#]/)[0];
  await p3.getByLabel("Titre de la note").fill(TITRE);
  await p3.getByLabel("Titre de la note").blur();
  await p3.locator('[data-testid="drawing-canvas"]').first().waitFor();
  const [sel3] = await Promise.all([
    p3.waitForEvent("filechooser"),
    p3.getByRole("button", { name: AJOUTER }).first().click(),
  ]);
  await sel3.setFiles("refs/ref-2.png");
  await p3.getByRole("button", { name: "Utiliser" }).click();
  await p3.waitForTimeout(2500);
  const image3 = bloc(id3).pages.find((pg) => "image" in pg)?.image;

  await p3.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await p3.waitForTimeout(1500);
  const vignette = p3.locator("li").filter({ hasText: TITRE }).first().locator('img[alt="Photo annotée"]');
  const src = (await vignette.count()) > 0 ? await vignette.getAttribute("src") : null;
  check(
    Boolean(image3) && Boolean(src?.includes(image3)),
    "sans rien écrire, la vignette montre la photo glissée — pas une page blanche",
    src ?? "aucune image en vignette",
  );
  await ctx3.close();
}

// --- Sur téléphone -----------------------------------------------------------
section("sur téléphone");
for (const theme of ["light", "dark"]) {
  const tel = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, colorScheme: theme,
  });
  await tel.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const petit = await tel.newPage();
  await petit.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
  const barre = petit.getByRole("toolbar", { name: "Outils d'écriture" }).first();
  await barre.waitFor();
  await barre.scrollIntoViewIfNeeded();
  const debord = await barre.evaluate((el) => el.scrollWidth - el.clientWidth);
  check(
    debord <= 1 && (await petit.getByRole("button", { name: AJOUTER }).first().isVisible()),
    `l'appareil photo tient dans la barre du téléphone (${theme})`,
    `${debord} px de trop`,
  );
  await barre.screenshot({ path: `shots/page-photo-barre-iphone-${theme}.png` });
  await tel.close();
}

await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nUne image devient une page, où qu'on soit.");
process.exit(echecs ? 1 : 0);
