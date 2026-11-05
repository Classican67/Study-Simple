/*
 * Une image posée sur une page, et tout ce qu'on peut faire de ce que le lasso
 * retient.
 *
 * Trois défauts ne se voient qu'ici, jamais dans les tests unitaires : une image
 * qui s'agrandit à l'écran sans que rien parte en base, un geste d'une seule
 * main qui laisse une entrée d'historique par image, et une image bien placée à
 * l'écran mais décalée dans le PDF.
 *
 * Les positions se relisent **en base** : c'est ce qui reste après rechargement.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "../node_modules/pdf-lib/cjs/index.js";
import { CONTRAST } from "./sondes.mjs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

const browser = await chromium.launch();
// Plus haut que l'écran d'un iPad : le lasso de ce scénario entoure toute la
// page, et un geste hors de la fenêtre ne parviendrait pas à la page.
const ctx = await browser.newContext({ viewport: { width: 1194, height: 1400 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});

const TITRE = `Images ${Date.now()}`;
const canvas = () => page.locator('[data-testid="drawing-canvas"]').first();
const cadre = () => page.locator('[data-testid="cadre-selection"]');
const barre = () => page.locator('[data-testid="barre-selection"]');

const base = new DatabaseSync("verif.db", { timeout: 3000 });
function contenuEnBase() {
  try {
    return lireContenu();
  } catch {
    // Le serveur écrit au même moment : la boucle d'`attendre` relira.
    return null;
  }
}
function lireContenu() {
  const note = base.prepare("SELECT id FROM Note WHERE title = ? ORDER BY createdAt DESC LIMIT 1").get(TITRE);
  if (!note) return null;
  const bloc = base
    .prepare("SELECT content FROM NoteBlock WHERE noteId = ? AND kind = 'drawing' ORDER BY position LIMIT 1")
    .get(note.id);
  return bloc ? JSON.parse(bloc.content) : null;
}

/** Relit jusqu'à ce que la base dise ce qu'on attend : l'enregistrement est différé. */
async function attendre(test, ms = 6000) {
  const fin = Date.now() + ms;
  for (;;) {
    const contenu = contenuEnBase();
    if (contenu && test(contenu)) return contenu;
    if (Date.now() > fin) return contenu;
    await page.waitForTimeout(100);
  }
}

async function trait(x0, y, longueur = 0.3) {
  await canvas().evaluate((el, [xx, yy, ll]) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, p, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
        pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * yy,
      }));
    f("pointerdown", xx, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", xx + (i * ll) / 14, 0.45, 1);
    f("pointerup", xx + ll, 0, 0);
  }, [x0, y, longueur]);
  await page.waitForTimeout(250);
}

async function glisser(selecteur, dx, dy) {
  const boite = await selecteur.boundingBox();
  const x = boite.x + boite.width / 2;
  const y = boite.y + boite.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

/** Entoure toute la page — à distance des coins, qui sont arrondis. */
async function toutEntourer(bp) {
  // Sous la pilule d'Annuler et des réglages, qui flottent en haut de la page.
  const marge = 16;
  const haut = 120;
  await page.mouse.move(bp.x + marge, bp.y + haut);
  await page.mouse.down();
  for (const [x, y] of [
    [bp.width - marge, haut],
    [bp.width - marge, bp.height - marge],
    [marge, bp.height - marge],
    [marge, haut],
  ]) {
    await page.mouse.move(bp.x + x, bp.y + y, { steps: 6 });
  }
  await page.mouse.up();
}

try {
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  const url = page.url();
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(700);

  // --- Poser -------------------------------------------------------------
  console.log("— poser une image");
  await page.locator("input[data-pose-image]").first().setInputFiles("photo.png");
  await page.getByRole("button", { name: "Utiliser" }).click();
  await page.waitForSelector("[data-image-posee]");
  let c = await attendre((d) => d.images?.length === 1);
  check(c?.images?.length === 1, "l'image posée part en base");
  const fichier = c.images[0].file;
  check(existsSync(`uploads/${fichier}`), "son fichier est dans le bac à sable");
  check(await cadre().isVisible(), "elle arrive retenue, prête à être placée");
  {
    // À l'écran d'un iPad ordinaire, et non dans cette fenêtre haute : c'est là
    // que la poignée partait hors de portée.
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.locator("input[data-pose-image]").first().setInputFiles("photo.png");
    await page.getByRole("button", { name: "Utiliser" }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-image-posee]").length === 2);
    await page.waitForTimeout(300);
    const bas = await page.locator('[data-poignee="se"]').boundingBox();
    check(bas.y + bas.height <= 834, "posée à l'écran, poignées comprises", `poignée à ${Math.round(bas.y + bas.height)} sur 834`);
    await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
    await attendre((d) => d.images.length === 1);
    await page.setViewportSize({ width: 1194, height: 1400 });
    await page.waitForTimeout(300);
    const im = await page.locator("[data-image-posee]").first().boundingBox();
    await page.mouse.click(im.x + im.width / 2, im.y + im.height / 2);
    await cadre().waitFor();
  }
  check(
    await page.locator("[data-image-posee]").first().evaluate((im) => im.naturalWidth > 0),
    "et elle s'affiche vraiment",
  );

  // --- Déplacer -----------------------------------------------------------
  console.log("— déplacer, redimensionner, tourner");
  const avant = c.images[0];
  await glisser(cadre(), 120, 70);
  c = await attendre((d) => d.images[0].x !== avant.x, 8000);
  const largeurPage = await canvas().evaluate((el) => el.getBoundingClientRect().width);
  check(
    Math.abs(c.images[0].x - avant.x - 120 / largeurPage) < 0.01,
    "déplacée de ce que la main a parcouru",
    `Δx ${(c.images[0].x - avant.x).toFixed(3)}, attendu ${(120 / largeurPage).toFixed(3)}`,
  );

  // Une seule entrée d'historique pour tout le geste.
  await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
  c = await attendre((d) => d.images[0].x === avant.x);
  check(c.images[0].x === avant.x, "Annuler rend la position d'avant le geste, en une fois");
  await page.getByRole("button", { name: "Rétablir", exact: true }).first().click();
  c = await attendre((d) => d.images[0].x !== avant.x);
  check(c.images[0].x !== avant.x, "Rétablir la redonne");

  // Annuler a vidé la sélection : on la reprend en touchant l'image.
  const img = page.locator("[data-image-posee]").first();
  const bi = await img.boundingBox();
  await page.mouse.click(bi.x + bi.width / 2, bi.y + bi.height / 2);
  await cadre().waitFor();
  check(true, "toucher une image avec le lasso la reprend");

  const w0 = c.images[0].w;
  const r0 = c.images[0].ratio;
  const centreAvant = c.images[0].x + w0 / 2;
  const coin = page.locator('[data-poignee="se"]');
  await glisser(coin, 90, 45);
  c = await attendre((d) => d.images[0].w !== w0);
  check(c.images[0].w > w0 * 1.2, "le coin l'agrandit", `${w0.toFixed(3)} → ${c.images[0].w.toFixed(3)}`);
  check(c.images[0].ratio === r0, "sans la déformer");
  check(Math.abs(c.images[0].x + c.images[0].w / 2 - centreAvant) < 0.002, "autour de son centre");
  const affichee = await img.boundingBox();
  check(
    Math.abs(affichee.width - c.images[0].w * largeurPage) < 2,
    "ce que la base dit est ce que l'écran montre",
    `${affichee.width.toFixed(1)} px, ${(c.images[0].w * largeurPage).toFixed(1)} attendus`,
  );

  // Réduire jusqu'au bout ne doit pas la perdre.
  await glisser(coin, -1500, -1000);
  c = await attendre((d) => d.images[0].w < 0.1);
  check(c.images[0].w >= 0.03, "on ne la réduit pas jusqu'à la perdre", `largeur ${c.images[0].w}`);
  await glisser(coin, 200, 100);
  await page.waitForTimeout(300);

  const rotation = page.locator('[data-poignee="rotation"]');
  const bc = await cadre().boundingBox();
  const br = await rotation.boundingBox();
  // Un quart de tour : de la pastille du haut vers la droite du cadre.
  await page.mouse.move(br.x + br.width / 2, br.y + br.height / 2);
  await page.mouse.down();
  await page.mouse.move(bc.x + bc.width + 40, bc.y + bc.height / 2 - 2, { steps: 10 });
  await page.mouse.up();
  c = await attendre((d) => Math.abs(d.images[0].angle) > 0.5);
  check(
    Math.abs(c.images[0].angle - Math.PI / 2) < 0.001,
    "la pastille tourne, et s'accroche au quart de tour",
    `${((c.images[0].angle * 180) / Math.PI).toFixed(2)}°`,
  );

  // --- Écrire dessus ------------------------------------------------------
  console.log("— écrire dessus, comme sur le reste de la page");
  await page.getByRole("button", { name: "Écrire", exact: true }).first().click();
  check((await cadre().count()) === 0, "quitter le lasso range le cadre");
  await trait(0.35, 0.3, 0.2);
  c = await attendre((d) => d.strokes.length === 1);
  check(c.strokes.length === 1, "le stylo écrit par-dessus l'image, il ne la saisit pas");

  // --- Copier / coller ----------------------------------------------------
  console.log("— copier, coller, couper, dupliquer");
  await trait(0.05, 0.14, 0.12);
  c = await attendre((d) => d.strokes.length === 2);

  await page.getByRole("button", { name: "Lasso", exact: true }).first().click();
  const bp = await canvas().boundingBox();
  // Un lasso autour de tout ce qu'on a écrit et de l'image.
  await toutEntourer(bp);
  await cadre().waitFor();
  const compte = page.getByText(/3 éléments/);
  check(await compte.count() > 0, "le lasso retient traits et image ensemble", await compte.first().textContent().catch(() => "?"));

  await barre().getByRole("button", { name: "Dupliquer la sélection" }).click();
  c = await attendre((d) => d.images.length === 2 && d.strokes.length === 4);
  check(c.images.length === 2 && c.strokes.length === 4, "dupliquer double traits et image");
  check(c.images[0].id !== c.images[1].id, "deux images, deux identifiants");
  check(c.images[0].file === c.images[1].file, "et un seul fichier");

  await barre().getByRole("button", { name: "Supprimer ce qui est sélectionné" }).click();
  c = await attendre((d) => d.images.length === 1 && d.strokes.length === 2);
  check(c.images.length === 1 && c.strokes.length === 2, "supprimer retire la copie, et elle seule");
  check(existsSync(`uploads/${fichier}`), "le fichier reste : l'autre image s'en sert");

  // Copier au clavier, coller dans une AUTRE note.
  await toutEntourer(bp);
  await cadre().waitFor();
  await page.keyboard.press("ControlOrMeta+c");
  await page.waitForTimeout(500);

  const presse = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.flatMap((i) => i.types);
  });
  check(presse.includes("image/png"), "le presse-papiers du système reçoit une image", presse.join(", "));

  const autre = await ctx.newPage();
  await autre.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await autre.getByRole("button", { name: "Nouvelle note" }).first().click();
  await autre.waitForURL(/\/notes\/[a-z0-9]+/);
  const titreAutre = `${TITRE} bis`;
  await autre.getByLabel("Titre de la note").fill(titreAutre);
  await autre.getByLabel("Titre de la note").blur();
  await autre.waitForSelector('[data-testid="drawing-canvas"]');
  await autre.waitForTimeout(700);
  await autre.locator('[data-testid="drawing-canvas"]').first().click({ position: { x: 300, y: 200 } }).catch(() => {});
  await autre.keyboard.press("ControlOrMeta+v");
  await autre.waitForTimeout(1500);
  const noteAutre = base.prepare("SELECT id FROM Note WHERE title = ?").get(titreAutre);
  const lu = JSON.parse(
    base.prepare("SELECT content FROM NoteBlock WHERE noteId = ? ORDER BY position LIMIT 1").get(noteAutre.id).content,
  );
  check(lu.images.length === 1 && lu.strokes.length === 2, "coller dans une autre note repose de vrais traits, pas une photo", `${lu.strokes.length} traits, ${lu.images.length} image`);

  // Quelque chose d'autre copié depuis : c'est lui qui se colle.
  await autre.evaluate(() => navigator.clipboard.writeText("rien à voir"));
  await autre.keyboard.press("ControlOrMeta+v");
  await autre.waitForTimeout(1200);
  const relu = JSON.parse(
    base.prepare("SELECT content FROM NoteBlock WHERE noteId = ? ORDER BY position LIMIT 1").get(noteAutre.id).content,
  );
  check(relu.strokes.length === 2, "copier autre chose entre-temps ne recolle pas le vieux fragment");
  check(relu.textes.length === 1 && relu.textes[0].markup === "rien à voir", "et le texte collé devient une zone de la feuille");
  const textes = base.prepare("SELECT content FROM NoteBlock WHERE noteId = ? AND kind = 'text'").all(noteAutre.id);
  check(textes.length === 0, "une feuille ne se découpe pas en blocs pour un texte collé");
  await autre.close();

  // Couper : ce qui part revient au collage.
  await page.bringToFront();
  await page.keyboard.press("ControlOrMeta+x");
  c = await attendre((d) => d.images.length === 0 && d.strokes.length === 0);
  check(c.images.length === 0 && c.strokes.length === 0, "couper vide la page");
  await page.getByRole("button", { name: "Coller" }).first().click();
  c = await attendre((d) => d.images.length === 1 && d.strokes.length === 2);
  check(c.images.length === 1 && c.strokes.length === 2, "« Coller » dans la barre rend ce qui a été coupé");

  // --- Coller une image depuis le système --------------------------------
  console.log("— image collée, image déposée");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const cx = canvas.getContext("2d");
    cx.fillStyle = "#2a7";
    cx.fillRect(0, 0, 400, 200);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await page.keyboard.press("ControlOrMeta+v");
  c = await attendre((d) => d.images.length === 2);
  check(c.images.length === 2, "une capture collée devient une image posée");
  check(Math.abs(c.images[1].ratio - 0.5) < 0.01, "à son format", String(c.images[1].ratio));

  const depose = await page.evaluateHandle(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    canvas.getContext("2d").fillRect(0, 0, 300, 300);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/webp"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "carre.webp", { type: "image/webp" }));
    return data;
  });
  const bcv = await canvas().boundingBox();
  await canvas().dispatchEvent("drop", {
    dataTransfer: depose,
    clientX: bcv.x + 200,
    clientY: bcv.y + 150,
  });
  c = await attendre((d) => d.images.length === 3);
  check(c.images.length === 3, "une image lâchée sur la page s'y pose");
  check(/\.png$/.test(c.images[2].file), "un WebP est ramené à ce qu'un PDF sait lire", c.images[2].file);

  // --- Pages ----------------------------------------------------------------
  console.log("— pages et export");
  await page.getByRole("button", { name: "Écrire", exact: true }).first().click();
  await page.getByRole("button", { name: "Ajouter une page après celle-ci" }).first().click();
  await page.waitForTimeout(800);

  // --- Rechargement -------------------------------------------------------
  await page.waitForTimeout(1200);
  const enregistre = contenuEnBase();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-image-posee]");
  check((await page.locator("[data-image-posee]").count()) === enregistre.images.length, "tout revient au rechargement");

  // --- PDF ----------------------------------------------------------------
  const noteId = url.split("/").at(-1);
  const pdf = await ctx.request.get(`${BASE}/api/notes/${noteId}/pdf`);
  check(pdf.ok(), "l'export PDF répond", String(pdf.status()));
  const doc = await PDFDocument.load(await pdf.body());
  const texte = Buffer.from(await pdf.body()).toString("latin1");
  const images = (texte.match(/\/Subtype\s*\/Image/g) ?? []).length;
  check(images >= 2, "le PDF embarque les images posées", `${images} images, ${doc.getPageCount()} pages`);

  // --- Mesures ------------------------------------------------------------
  console.log("— mesures de la barre et du cadre");
  for (const schema of ["light", "dark"]) {
    for (const [nom, w, h] of [["téléphone", 393, 852], ["desktop", 1280, 900]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: schema, deviceScaleFactor: 2 });
      await c2.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      const p = await c2.newPage();
      await p.addInitScript((s) => {
        document.documentElement.classList.toggle("dark", s === "dark");
      }, schema);
      await p.goto(url, { waitUntil: "networkidle" });
      await p.evaluate((s) => {
        document.documentElement.classList.toggle("dark", s === "dark");
        document.documentElement.classList.toggle("light", s === "light");
      }, schema);
      await p.getByRole("button", { name: "Lasso", exact: true }).first().click();
      const im = p.locator("[data-image-posee]").nth(1);
      await im.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await p.waitForTimeout(200);
      const b = await im.boundingBox();
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await p.locator('[data-testid="cadre-selection"]').waitFor();
      const mesure = await p.evaluate(`(() => {
        const racines = [...document.querySelectorAll('[data-testid="barre-selection"] button, [data-poignee]')];
        return racines.map((el) => {
          const r = el.getBoundingClientRect();
          return { nom: el.getAttribute("aria-label"), l: r.width, h: r.height };
        });
      })()`);
      const petits = mesure.filter((m) => m.l < 44 || m.h < 44);
      check(petits.length === 0, `cibles de 44 px — ${nom}, ${schema}`, petits.map((m) => `${m.nom} ${m.l}×${m.h}`).join(", "));
      const contraste = await p.evaluate(CONTRAST);
      check(contraste.length === 0, `contraste — ${nom}, ${schema}`, JSON.stringify(contraste.slice(0, 2)));
      const debord = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(debord <= 1, `pas de débordement — ${nom}, ${schema}`, `${debord} px`);
      await p.screenshot({ path: `shots/image-posee-${nom}-${schema}.png` });
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
