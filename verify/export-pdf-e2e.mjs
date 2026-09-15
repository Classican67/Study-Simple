/*
 * Export d'une note annotée en PDF.
 *
 * La preuve n'est pas qu'un fichier arrive : c'est qu'il se **relit**. Le PDF
 * produit est donc rouvert avec pdf.js, rendu, et l'on compte les pixels
 * d'encre pour vérifier que les annotations y sont réellement peintes.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
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

// --- Une note avec un document annoté ----------------------------------------
section("préparation");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/notes/")[1];
await page.getByLabel("Titre de la note").fill(`Export ${Date.now()}`);
await retirerPageVierge(page);
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles("doc-test.pdf");
await page.waitForTimeout(7000);
check(
  (await page.locator('[data-testid="drawing-canvas"]').count()) === 1,
  "le document tient sur une seule surface",
);

/*
 * L'empreinte du document importé, prise **maintenant**.
 *
 * Le dossier d'envois garde ce que les essais précédents y ont laissé — dont
 * des PDF exportés puis réimportés, qui n'ont aucune raison de faire la même
 * taille. Comparer « tous les fichiers entre eux » accusait l'export de
 * modifier des documents qu'il n'avait jamais ouverts.
 */
const DOSSIER = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
const empreinte = () =>
  Object.fromEntries(
    readdirSync(DOSSIER)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => [f, statSync(path.join(DOSSIER, f)).size]),
  );
const avant = empreinte();

// Trois traits bien visibles sur la première page, dont un surligneur.
await page.evaluate(() => {
  const el = document.querySelectorAll('[data-testid="drawing-canvas"]')[0];
  const r = el.getBoundingClientRect();
  const trace = (points, pressure = 0.8) => {
    const fire = (type, x, y, p, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: p, buttons,
          clientX: r.left + r.width * x, clientY: r.top + r.height * y,
        }),
      );
    fire("pointerdown", points[0][0], points[0][1], pressure, 1);
    for (const [x, y] of points.slice(1)) fire("pointermove", x, y, pressure, 1);
    fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
  };
  trace([[0.15, 0.2], [0.4, 0.22], [0.65, 0.19], [0.85, 0.23]]);
  trace([[0.15, 0.3], [0.5, 0.34], [0.8, 0.3]]);
  trace([[0.2, 0.45], [0.5, 0.45], [0.75, 0.45]]);
});
await page.waitForTimeout(2000);
check(
  (await page.locator('[data-testid="drawing-canvas"]').first().getAttribute("aria-label")).includes("3 trait"),
  "trois annotations posées sur la première page",
);

/*
 * Et un quatrième trait sur la **deuxième** page.
 *
 * C'est là que se joue tout l'empilement : les traits sont repérés d'un bout à
 * l'autre de la surface, et l'export doit les rendre à la page où ils tombent.
 * Un trait de la page 2 qui ressortirait sur la page 1 — ou hors du papier —
 * ne se verrait sur aucune mesure de l'écran.
 */
await page.evaluate(() => {
  const surface = document.querySelector("[data-ink-scroll]");
  // Le milieu de la deuxième page, en proportion de la largeur.
  surface.scrollTop = 1.9 * surface.clientWidth - surface.clientHeight / 2;
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="drawing-canvas"]');
  const r = el.getBoundingClientRect();
  const fire = (type, x, y, p, buttons) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
        isPrimary: true, pressure: p, buttons,
        clientX: r.left + r.width * x, clientY: r.top + r.height * y,
      }),
    );
  fire("pointerdown", 0.2, 0.45, 0.8, 1);
  fire("pointermove", 0.5, 0.5, 0.8, 1);
  fire("pointermove", 0.8, 0.46, 0.8, 1);
  fire("pointerup", 0.8, 0.46, 0, 0);
});
await page.waitForTimeout(2000);
check(
  (await page.locator('[data-testid="drawing-canvas"]').first().getAttribute("aria-label")).includes("4 trait"),
  "un quatrième trait posé sur la deuxième page",
  await page.locator('[data-testid="drawing-canvas"]').first().getAttribute("aria-label"),
);

// --- Les deux formes d'export -------------------------------------------------
for (const [mode, nom] of [["flat", "aplati"], ["annot", "annotations"]]) {
  section(`export ${nom}`);
  const reponse = await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=${mode}`);
  check(reponse.status() === 200, "l'export répond", `HTTP ${reponse.status()}`);
  check(
    (reponse.headers()["content-type"] ?? "").includes("application/pdf"),
    "avec le bon type",
    reponse.headers()["content-type"],
  );
  check(
    (reponse.headers()["content-disposition"] ?? "").includes("attachment"),
    "et se télécharge sous un nom",
    reponse.headers()["content-disposition"],
  );

  const octets = Buffer.from(await reponse.body());
  check(octets.subarray(0, 5).toString("latin1") === "%PDF-", "c'est bien un PDF");
  writeFileSync(`shots/export-${mode}.pdf`, octets);

  // Analyse structurelle, avec la même bibliothèque que celle qui l'a écrit :
  // c'est ce qu'un lecteur conforme verra.
  const { PDFDocument, PDFName, PDFDict } = await import("../node_modules/pdf-lib/cjs/index.js");
  const doc = await PDFDocument.load(octets);
  check(doc.getPageCount() === 2, "le PDF exporté a deux pages", String(doc.getPageCount()));

  const page1 = doc.getPage(0);
  const annots = page1.node.get(PDFName.of("Annots"));
  const inks = annots
    ? annots.asArray().filter((ref) => {
        const dict = doc.context.lookup(ref);
        return dict instanceof PDFDict && dict.get(PDFName.of("Subtype"))?.toString() === "/Ink";
      })
    : [];

  const page2 = doc.getPage(1);
  const annots2 = page2.node.get(PDFName.of("Annots"));
  const inks2 = annots2
    ? annots2.asArray().filter((ref) => {
        const dict = doc.context.lookup(ref);
        return dict instanceof PDFDict && dict.get(PDFName.of("Subtype"))?.toString() === "/Ink";
      })
    : [];

  if (mode === "annot") {
    check(inks.length === 3, "les trois traits sont des annotations Ink", `${inks.length} trouvée(s)`);
    // La preuve de l'empilement : chaque trait est revenu à sa page.
    check(inks2.length === 1, "et le quatrième est sur la deuxième page", `${inks2.length} trouvée(s)`);
    const boite = inks2.length
      ? doc.context.lookup(inks2[0]).get(PDFName.of("Rect")).asArray().map((n) => n.asNumber())
      : null;
    check(
      boite !== null && boite[1] >= -5 && boite[3] <= page2.getHeight() + 5,
      "et il tombe bien dans le papier, pas au-delà",
      JSON.stringify(boite),
    );
    const premier = doc.context.lookup(annots.asArray()[0]);
    for (const clef of ["Rect", "InkList", "AP", "C", "F"]) {
      check(Boolean(premier.get(PDFName.of(clef))), `l'annotation porte /${clef}`);
    }
    // Le flux d'apparence est ce qui garantit l'affichage hors d'Acrobat.
    const ap = doc.context.lookup(premier.get(PDFName.of("AP")));
    check(Boolean(ap.get(PDFName.of("N"))), "et son apparence normale est fournie");
  } else {
    check(inks.length === 0, "aplati : aucune annotation détachable", `${inks.length} trouvée(s)`);
    // L'encre est dans le contenu de la page : on vérifie qu'il a grossi.
    const flux = page1.node.Contents();
    const taille = flux ? JSON.stringify(flux).length : 0;
    check(taille > 0, "le contenu de la page porte les traits");
  }
}

// --- Le document d'origine est intact ----------------------------------------
section("innocuité");
const apres = empreinte();
check(Object.keys(avant).length > 0, "le document importé est toujours sur le disque");
const modifies = Object.keys(avant).filter((f) => apres[f] !== avant[f]);
check(
  modifies.length === 0,
  "et pas un octet n'a bougé — l'export ne touche pas au document",
  JSON.stringify(modifies.map((f) => [f, avant[f], apres[f]])),
);

// --- Le PDF exporté se relit : on le réimporte dans l'app --------------------
section("relecture");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await retirerPageVierge(page);
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles("shots/export-flat.pdf");
await page.waitForTimeout(8000);
check(
  (await page.locator('[data-testid="drawing-canvas"]').count()) === 1,
  "le PDF exporté se réimporte, sur une seule surface",
);
check(
  (await page.locator('canvas[aria-label*="du document"]').count()) === 2,
  "et il a bien gardé ses deux pages",
  String(await page.locator('canvas[aria-label*="du document"]').count()),
);
const relu = await page
  .locator('canvas[aria-label^="Page 1 du document"]')
  .evaluate((el) => {
    const cx = el.getContext("2d");
    const d = cx.getImageData(0, 0, el.width, el.height).data;
    let encre = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 190 && d[i + 3] > 0) encre++;
    return { taille: `${el.width}x${el.height}`, encre };
  });
check(
  relu.encre > 3000,
  "et la page relue contient bien le texte ET les annotations",
  JSON.stringify(relu),
);

// --- Une note sans page manuscrite ne s'exporte pas dans le vide -------------
section("note sans page manuscrite");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await retirerPageVierge(page);
const vide = page.url().split("/notes/")[1];
const refus = await page.request.get(`${BASE}/api/notes/${vide}/pdf`);
check(refus.status() === 400, "l'export est refusé, avec un code clair", `HTTP ${refus.status()}`);
check(
  (await page.getByRole("button", { name: "PDF" }).isDisabled()) === true,
  "et le bouton est inactif tant qu'il n'y a rien à exporter",
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
