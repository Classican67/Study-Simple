/*
 * Chercher une notion dans les documents importés — y compris scannés.
 *
 * Le scan est fabriqué ici : une page sans aucune couche de texte, rien qu'une
 * image. Il n'y a donc que l'OCR pour y trouver quoi que ce soit, et c'est la seule
 * preuve qui vaille : un PDF ordinaire passerait par sa couche de texte et l'on
 * croirait l'OCR éprouvé.
 *
 * La place du surlignage est mesurée sur l'écran : un mot trouvé mais surligné à
 * côté ne vaut rien.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createCanvas } from "../node_modules/@napi-rs/canvas/index.js";
import { PDFDocument, StandardFonts } from "../node_modules/pdf-lib/cjs/index.js";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const MARQUE = `${Date.now()}`.slice(-6);

let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

/** Un scan : du texte peint dans une image, et une page PDF qui ne contient qu'elle. */
async function scan() {
  const doc = await PDFDocument.create();
  const pages = [
    ["Introduction générale", "Le cours commence ici sans notion précise."],
    ["La chaîne respiratoire", "La mitochondrie produit l'énergie de la cellule.", "Elle possède sa propre membrane interne."],
  ];
  for (const lignes of pages) {
    const canvas = createCanvas(1240, 1754);
    const c = canvas.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 1240, 1754);
    c.fillStyle = "#111";
    c.font = "48px Arial";
    lignes.forEach((ligne, i) => c.fillText(ligne, 120, 700 + i * 90));
    const image = await doc.embedPng(canvas.toBuffer("image/png"));
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}

/** Un PDF ordinaire, à couche de texte, avec une césure en fin de ligne. */
async function texte() {
  const doc = await PDFDocument.create();
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(`Cours ${MARQUE} sur le sang et ses cellules`, { x: 60, y: 760, size: 14, font: police });
  page.drawText("Le transport de l'oxygene depend de l'hemo-", { x: 60, y: 730, size: 14, font: police });
  page.drawText("globine contenue dans les globules rouges.", { x: 60, y: 710, size: 14, font: police });
  return Buffer.from(await doc.save());
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});

const base = new DatabaseSync("verif.db", { timeout: 3000 });
const importer = async (nom, octets) => {
  const reponse = await ctx.request.post(`${BASE}/api/notes/import`, {
    multipart: { document: { name: nom, mimeType: "application/pdf", buffer: octets } },
    headers: { Accept: "application/json" },
  });
  return reponse.json();
};

async function attendreLecture(noteId, ms = 90000) {
  const fin = Date.now() + ms;
  for (;;) {
    const r = await ctx.request.get(`${BASE}/api/notes/${noteId}/recherche?q=`);
    const { etat } = await r.json();
    if (etat.total > 0 && !etat.enCours) return etat;
    if (Date.now() > fin) return etat;
    await page.waitForTimeout(400);
  }
}

async function chercherPartout(mot) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.keyboard.press("ControlOrMeta+k");
  const champ = page.getByRole("searchbox", { name: "Rechercher" });
  await champ.fill(mot);
  await page.waitForSelector('[role="option"]', { timeout: 6000 }).catch(() => {});
}

try {
  console.log("— lecture");
  const { noteId } = await importer(`Bioénergétique ${MARQUE}.pdf`, await scan());
  check(Boolean(noteId), "le scan s'importe", String(noteId));

  // Tout de suite : la loupe doit dire qu'elle lit, pas « aucun résultat ».
  await page.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.getByRole("button", { name: "Chercher dans le document" }).first().click();
  await page.getByLabel("Mot à chercher").fill("mitochondrie");
  const dit = await page
    .locator('[data-testid="loupe"]')
    .getByText(/Lecture du document|\d+\/\d+/)
    .first()
    .textContent({ timeout: 4000 })
    .catch(() => "");
  check(/Lecture|\//.test(dit), "pendant la lecture, la loupe le dit au lieu d'annoncer zéro", dit);

  const etat = await attendreLecture(noteId);
  check(etat.lus === 1 && etat.echecs === 0, "le document est lu en entier", JSON.stringify(etat));

  const lu = base
    .prepare("SELECT d.page, d.ocr, d.texte FROM DocumentPage d JOIN NoteDocument n ON n.file = d.file WHERE n.noteId = ? ORDER BY d.page")
    .all(noteId);
  check(lu.length === 2 && lu.every((p) => p.ocr === 1), "les deux pages sont passées par l'OCR");
  check(/mitochondrie/i.test(lu[1]?.texte ?? ""), "l'OCR a lu le mot sur l'image", (lu[1]?.texte ?? "").replace(/\s+/g, " ").slice(0, 80));

  console.log("— la loupe");
  await page.waitForSelector('[data-surligne="actif"]', { timeout: 10000 });
  const compte = await page.locator('[data-testid="loupe"] [role="status"]').first().textContent();
  check(/^1\/\d+$/.test(compte.trim()), "elle compte les occurrences", compte);

  // Le mot est à la ligne y ≈ 790/1754 de la 2ᵉ page, x ≈ 120/1240 + « La ».
  const place = await page.evaluate(() => {
    const s = document.querySelector("[data-ink-scroll]");
    const r = document.querySelector('[data-surligne="actif"]');
    const box = r.getBoundingClientRect();
    const page = document.querySelector("[data-ink-scroll] > div").getBoundingClientRect();
    return {
      visible: box.top >= s.getBoundingClientRect().top && box.bottom <= s.getBoundingClientRect().bottom,
      x: (box.left - page.left) / page.width,
      y: (box.top - page.top) / page.width,
      l: box.width / page.width,
    };
  });
  const ratio = 842 / 595;
  const hautPage2 = ratio + 0.02;
  const attenduY = hautPage2 + (790 - 45) / 1240;
  check(place.visible, "elle amène l'occurrence à l'écran");
  check(Math.abs(place.y - attenduY) < 0.03, "le surlignage tombe sur le mot, en hauteur", `${place.y.toFixed(3)} pour ${attenduY.toFixed(3)}`);
  check(place.x > 0.13 && place.x < 0.22 && place.l > 0.15 && place.l < 0.35, "et en largeur", `x ${place.x.toFixed(3)}, l ${place.l.toFixed(3)}`);
  await page.screenshot({ path: "shots/loupe-scan.png" });

  await page.getByLabel("Mot à chercher").fill("inexistant");
  await page.getByText("Aucun résultat dans cette page.").waitFor({ timeout: 5000 });
  check((await page.locator("[data-surligne]").count()) === 0, "rien de trouvé, rien de surligné");
  await page.keyboard.press("Escape");
  check((await page.locator('[data-testid="loupe"]').count()) === 0, "Échap referme la loupe");

  console.log("— un PDF à couche de texte");
  const texteNote = await importer(`Hématologie ${MARQUE}.pdf`, await texte());
  await attendreLecture(texteNote.noteId);
  const lueTexte = base
    .prepare("SELECT d.ocr, d.searchText FROM DocumentPage d JOIN NoteDocument n ON n.file = d.file WHERE n.noteId = ?")
    .get(texteNote.noteId);
  check(lueTexte?.ocr === 0, "il ne passe pas par l'OCR");
  check(lueTexte?.searchText.includes("hemoglobine"), "et une césure de fin de ligne est recollée");

  console.log("— la recherche globale");
  await chercherPartout("mitochondrie");
  const options = page.locator('[role="option"]');
  const textes = await options.allTextContents();
  check(textes.some((t) => /Page 2/.test(t)), "la page du document sort dans la recherche globale", textes.slice(0, 3).join(" | ").slice(0, 120));
  check(textes.some((t) => /Bioénergétique/.test(t)), "avec la note qui le porte");
  await page.screenshot({ path: "shots/recherche-globale.png" });

  await options.filter({ hasText: "Page 2" }).first().click();
  await page.waitForURL(/cherche=mitochondrie/);
  await page.waitForSelector('[data-surligne="actif"]', { timeout: 10000 });
  check(true, "le résultat ouvre la note, loupe ouverte, mot surligné");
  const scrolle = await page.evaluate(() => document.querySelector("[data-ink-scroll]").scrollTop);
  check(scrolle > 200, "à la bonne page", `défilement ${Math.round(scrolle)} px`);

  await chercherPartout("hemoglobine");
  const trouve = await page.locator('[role="option"]').allTextContents();
  check(trouve.some((t) => /Hématologie/.test(t)), "« hemoglobine », sans accent, trouve « hémo-globine »");

  await page.goto(`${BASE}/notes?q=mitochondrie`, { waitUntil: "networkidle" });
  check((await page.getByText(`Bioénergétique ${MARQUE}`).count()) > 0, "la recherche de la liste des notes voit les documents aussi");

  console.log("— cloisonnement et ménage");
  const anonyme = await browser.newContext();
  const refus = await anonyme.request.get(`${BASE}/api/notes/${noteId}/recherche?q=mitochondrie`, { maxRedirects: 0 });
  check(refus.status() === 401 || refus.status() === 307, "sans session, la loupe ne répond pas", String(refus.status()));
  await anonyme.close();
  const fichier = base.prepare("SELECT file FROM NoteDocument WHERE noteId = ?").get(noteId).file;
  await page.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Actions de la note" }).first().click();
  await page.getByRole("button", { name: "Supprimer la note" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.waitForURL(/\/notes(\?|$)/);
  await page.waitForTimeout(600);
  const reste = base.prepare("SELECT count(*) AS n FROM DocumentPage WHERE file = ?").get(fichier).n;
  check(reste === 0, "supprimer la note retire ce qu'on avait lu du document", `${reste} page(s) restante(s)`);
} catch (e) {
  console.log("❌ arrêt :", e);
  echecs++;
}

await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
