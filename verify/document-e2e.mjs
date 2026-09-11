/*
 * Import d'un document à annoter.
 *
 * Un PDF de deux pages doit produire deux pages manuscrites, au bon format,
 * annotables, et l'annotation doit survivre au rechargement. La conversion
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

const blocsAvant = await page.locator("section[aria-label^='Bloc']").count();
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles("doc-test.pdf");
await page.waitForTimeout(6000);

const blocs = await page.locator("section[aria-label^='Bloc']").count();
// Sans recharger : les pages doivent apparaître tout de suite, sinon on
// réimporte le document en croyant que rien ne s'est passé.
check(blocs === blocsAvant + 2, `le PDF de deux pages donne deux pages annotables`, `${blocsAvant} → ${blocs}`);

const toiles = page.locator('[data-testid="drawing-canvas"]');
check((await toiles.count()) === 2, "deux canevas manuscrits");

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

// Le format de la page suit celui du document : A4 fait environ 1,414.
const format = await toiles.first().evaluate((el) => {
  const p = el.parentElement;
  return Number((p.clientHeight / p.clientWidth).toFixed(2));
});
check(Math.abs(format - 1.41) < 0.06, `la page est au format du document (${format})`);

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

// --- Refus propre d'un format non pris en charge ----------------------------
section("refus");
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const input = document.querySelector('input[type="file"][accept*=".pdf"]');
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

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
