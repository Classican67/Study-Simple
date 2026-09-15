/*
 * Import d'un document à annoter.
 *
 * Un PDF de deux pages doit produire **une seule** surface annotable portant
 * ses deux pages, au bon format, et l'annotation doit survivre au
 * rechargement. La conversion
 * Word passe par LibreOffice : elle ne peut pas être éprouvée ici, seulement
 * son refus propre en son absence.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const UPLOADS = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 150)); ko++; });

// --- Import d'un PDF ---------------------------------------------------------
section("import d'un PDF");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const url = page.url();
await page.getByLabel("Titre de la note").fill(`Polycopié ${Date.now()}`);

await retirerPageVierge(page);
const blocsAvant = await page.locator("section[aria-label^='Bloc']").count();
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles("doc-test.pdf");
await page.waitForTimeout(6000);

const blocs = await page.locator("section[aria-label^='Bloc']").count();
// Sans recharger : la surface doit apparaître tout de suite, sinon on
// réimporte le document en croyant que rien ne s'est passé.
check(
  blocs === blocsAvant + 1,
  "le document entier tient dans un seul bloc, pas un par page",
  `${blocsAvant} → ${blocs}`,
);

const toiles = page.locator('[data-testid="drawing-canvas"]');
check((await toiles.count()) === 1, "un seul canevas manuscrit", `${await toiles.count()}`);

// --- Le document est affiché sous les annotations ----------------------------
section("rendu du document");
await page.waitForTimeout(2000);
const pdfCanvas = page.locator('canvas[aria-label^="Page 1 du document"]');
check((await pdfCanvas.count()) === 1, "la page 1 du document est rendue");
const peint = await pdfCanvas.evaluate((el) => {
  const cx = el.getContext("2d");
  if (!el.width || !el.height) return { taille: `${el.width}x${el.height}`, encre: 0 };
  // Toute la page : l'origine d'un PDF est en bas à gauche, un texte « en
  // haut » du document se retrouve au milieu du canevas.
  const data = cx.getImageData(0, 0, el.width, el.height).data;
  let encre = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 200 && data[i + 3] > 0) encre++;
  return { taille: `${el.width}x${el.height}`, encre };
});
check(peint.encre > 100, "et elle contient bien du texte dessiné", JSON.stringify(peint));

// La surface fait la hauteur des deux pages, chacune au format du document :
// un A4 vaut environ 1,414 de large, deux en valent le double et des poussières.
const format = await page.locator("[data-ink-scroll] > div").first().evaluate((el) => {
  const parent = el.parentElement;
  return Number((el.clientHeight / parent.clientWidth).toFixed(2));
});
check(
  Math.abs(format - 2.85) < 0.12,
  `la surface porte les deux pages du document (${format})`,
  "attendu ≈ 2,85",
);

// Et les deux pages y sont bien, l'une sous l'autre.
const pages = await page.locator('canvas[aria-label^="Page "][aria-label*="du document"]').evaluateAll((els) =>
  els.map((el) => ({
    label: el.getAttribute("aria-label"),
    haut: Math.round(el.getBoundingClientRect().top),
  })),
);
check(pages.length === 2, "les deux pages sont rendues sur la même surface", JSON.stringify(pages));
check(
  pages.length === 2 && pages[1].haut > pages[0].haut,
  "la seconde est sous la première",
  JSON.stringify(pages),
);

// --- On annote par-dessus, et ça tient ---------------------------------------
section("annotation");
await page.evaluate(() => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[0];
  const r = el.getBoundingClientRect();
  const fire = (type, x, y, pressure, buttons) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
        isPrimary: true, pressure, buttons,
        clientX: r.left + r.width * x, clientY: r.top + r.height * y,
      }),
    );
  fire("pointerdown", 0.2, 0.2, 0.4, 1);
  fire("pointermove", 0.4, 0.3, 0.7, 1);
  fire("pointermove", 0.6, 0.25, 0.9, 1);
  fire("pointerup", 0.6, 0.25, 0, 0);
});
await page.waitForTimeout(600);
check(
  (await toiles.first().getAttribute("aria-label")).includes("1 trait"),
  "on annote le document au stylet",
);

await page.waitForTimeout(1400);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
check(
  (await page.locator('[data-testid="drawing-canvas"]').first().getAttribute("aria-label")).includes("1 trait"),
  "l'annotation est enregistrée",
);
check(
  (await page.locator('canvas[aria-label^="Page 1 du document"]').count()) === 1,
  "et le document est toujours là — annoter ne l'efface pas",
);
await page.screenshot({ path: "shots/document-annote.png" });

// --- Le fichier est bien un PDF stocké --------------------------------------
section("stockage");
const { readdirSync } = await import("node:fs");
const pdfs = existsSync(UPLOADS) ? readdirSync(UPLOADS).filter((f) => f.endsWith(".pdf")) : [];
check(pdfs.length >= 1, `le document est stocké en PDF (${pdfs.length})`, UPLOADS);
check(
  pdfs.every((f) => /^[0-9a-f-]{36}\.pdf$/.test(f)),
  "sous un nom produit par l'app, jamais celui de l'envoi",
  pdfs.join(", "),
);
const reponse = await page.request.get(`${BASE}/api/uploads/${pdfs[0]}`);
check(reponse.status() === 200, "et il se sert correctement", `HTTP ${reponse.status()}`);
check(
  (reponse.headers()["content-type"] ?? "").includes("application/pdf"),
  "avec le bon type",
  reponse.headers()["content-type"],
);

/*
 * Les plages, sans lesquelles pdf.js télécharge tout avant la première page.
 *
 * C'est ce qui faisait qu'un polycopié scanné mettait une minute à s'ouvrir sur
 * iPad, l'écran blanc jusqu'à la fin du téléchargement. pdf.js n'y recourt que
 * si le serveur les annonce **et** répond 206.
 */
check(
  (reponse.headers()["accept-ranges"] ?? "") === "bytes",
  "le serveur annonce savoir servir des plages",
  reponse.headers()["accept-ranges"],
);
const taille = Number(reponse.headers()["content-length"]);
const morceau = await page.request.get(`${BASE}/api/uploads/${pdfs[0]}`, {
  headers: { Range: "bytes=0-63" },
});
check(morceau.status() === 206, "et il en sert une pour de vrai", `HTTP ${morceau.status()}`);
check(
  morceau.headers()["content-range"] === `bytes 0-63/${taille}`,
  "en annonçant exactement ce qu'il envoie",
  morceau.headers()["content-range"],
);
check((await morceau.body()).length === 64, "et pas un octet de plus", String((await morceau.body()).length));
const horsBornes = await page.request.get(`${BASE}/api/uploads/${pdfs[0]}`, {
  headers: { Range: `bytes=${taille + 10}-` },
});
check(horsBornes.status() === 416, "une plage hors du fichier est refusée proprement", `HTTP ${horsBornes.status()}`);

// --- Refus propre d'un format non pris en charge ----------------------------
section("refus");
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const input = document.querySelector('input[type="file"][accept*=".pdf"]:not([data-page-image])');
  const data = new DataTransfer();
  data.items.add(new File(["PKrien"], "archive.zip", { type: "application/zip" }));
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(2500);
const alerte = await page.locator('[role="alert"]').first().innerText().catch(() => "");
check(
  alerte.includes("Format non pris en charge"),
  "un format inconnu est refusé, avec un message clair",
  alerte,
);

// --- Ce qui bloquait l'import sur iPad -------------------------------------
/*
 * Trois obstacles, dans cet ordre, et aucun ne se voyait sur un poste de
 * développement avec un PDF de deux pages :
 *
 * 1. **Le mégaoctet.** L'import passait par une action serveur, dont le corps
 *    est plafonné à 1 Mo. Next refusait la requête avant tout appel de code, la
 *    promesse était rejetée sans être attrapée, et le bouton restait sur
 *    « Conversion… » indéfiniment. Un PDF scanné dépasse le mégaoctet dès deux
 *    pages : c'était donc *toujours* le cas sur iPad.
 * 2. **Le type manquant.** iOS annonce régulièrement `application/octet-stream`
 *    pour un fichier venu de l'app Fichiers ou d'AirDrop. Se fier au seul
 *    en-tête faisait refuser sur iPad ce que le même navigateur acceptait
 *    ailleurs.
 * 3. **L'absence de sortie.** Rien ne permettait d'interrompre, et rien ne
 *    disait où en était l'envoi.
 */
section("import lourd, et type manquant");

const { createRequire } = await import("node:module");
const requerir = createRequire(new URL("../package.json", import.meta.url));
const { PDFDocument, PDFRawStream, PDFName } = requerir("pdf-lib");

/**
 * Un PDF valide de quelques mégaoctets, comme un cours scanné.
 *
 * Le poids vient d'un flux de données brut enregistré dans le document — pas
 * d'un remplissage après `%%EOF`, qui ferait un fichier que les lecteurs
 * tolèrent mais dont rien ne garantit qu'il reste lisible.
 */
async function grosPdf(mo) {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText("Cours scanné", { x: 60, y: 760, size: 24 });
  doc.addPage([595, 842]);
  const bruit = Buffer.alloc(mo * 1024 * 1024);
  for (let i = 0; i < bruit.length; i++) bruit[i] = i & 0xff;
  const flux = PDFRawStream.of(
    doc.context.obj({ Type: "EmbeddedFile", Length: bruit.length }),
    bruit,
  );
  doc.catalog.set(PDFName.of("FichesBruit"), doc.context.register(flux));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const lourd = await grosPdf(3);
check(lourd.length > 1024 * 1024, "le PDF d'essai dépasse le plafond d'une action serveur", `${(lourd.length / 1024 / 1024).toFixed(1)} Mo`);

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const avantLourd = await page.locator('[data-testid="drawing-canvas"]').count();

const debutLourd = Date.now();
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles({
  name: "scan.pdf",
  // Le type qu'iOS envoie quand il ne sait pas : c'est le cas à éprouver.
  mimeType: "application/octet-stream",
  buffer: lourd,
});

// La sortie de secours est offerte pendant l'envoi, pas seulement après.
const interrompre = page.getByRole("button", { name: "Interrompre l'import" });
check(
  await interrompre.isVisible().catch(() => false) ||
    (await page.locator("text=/Envoi \\d+ %|Conversion…/").count()) > 0,
  "l'envoi s'annonce, et peut être interrompu",
);

await page
  .locator('[data-testid="drawing-canvas"]')
  .nth(avantLourd)
  .waitFor({ timeout: 90000 })
  .catch(() => {});
const secondes = (Date.now() - debutLourd) / 1000;
console.log(`   import de ${(lourd.length / 1024 / 1024).toFixed(1)} Mo : ${secondes.toFixed(1)} s`);

check(
  (await page.locator('[data-testid="drawing-canvas"]').count()) > avantLourd,
  "un PDF de plusieurs mégaoctets s'importe, sans type MIME reconnaissable",
  await page.locator('[role="alert"]').first().innerText().catch(() => ""),
);
// Et surtout : l'interface est revenue au repos, quoi qu'il arrive.
await page.getByRole("button", { name: "Document", exact: true }).waitFor({ timeout: 30000 });
check(true, "et le bouton revient à son état de repos — jamais de chargement sans fin");

// --- Refus immédiat d'un fichier hors limite -------------------------------
section("trop lourd");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const debutRefus = Date.now();
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles({
  name: "enorme.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.alloc(41 * 1024 * 1024),
});
const refus = await page
  .locator('[role="alert"]')
  .first()
  .innerText({ timeout: 15000 })
  .catch(() => "");
const delaiRefus = Date.now() - debutRefus;
check(/trop lourd/i.test(refus), "un document hors limite est refusé, avec sa taille", refus);
check(
  delaiRefus < 10000,
  "et refusé tout de suite, sans avoir envoyé quarante mégaoctets",
  `${(delaiRefus / 1000).toFixed(1)} s`,
);
check(
  (await page.getByRole("button", { name: "Document", exact: true }).count()) === 1,
  "le bouton reste utilisable",
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);


/**
 * Une note neuve s'ouvre sur une page manuscrite vierge. Les essais qui importent
 * un document veulent une note où ce document est seul — ou une note vraiment
 * vide : on retire d'abord cette page.
 */
async function retirerPageVierge(page) {
  await page.getByRole("button", { name: "Supprimer le bloc 1" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.locator("section[aria-label^='Bloc']").first().waitFor({ state: "detached" });
}
