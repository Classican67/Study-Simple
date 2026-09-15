/*
 * Le PDF exporté, regardé page par page.
 *
 * Le fond d'une page ajoutée est dessiné en CSS à l'écran et redessiné en
 * opérateurs PDF à l'export : deux techniques pour une même géométrie. Compter
 * les traits prouve qu'ils sont là, pas qu'ils tombent au bon endroit ni qu'ils
 * ont la bonne teinte. On rend donc le PDF produit, avec le même moteur que
 * l'application, et on le regarde.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();

// --- Une note : document importé, page ajoutée à lignes, annotations ---------
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/").pop();
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles("doc-test.pdf");
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.getByRole("button", { name: "Document", exact: true }).waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);

await page.getByRole("button", { name: "Ajouter une page après celle-ci" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Lignes", exact: true }).click();
await page.waitForTimeout(800);

// Deux lignes d'écriture sur la page ajoutée, pour juger le rapport entre
// l'encre et le réglage sur le papier.
await page.evaluate(async () => {
  const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
  const scroller = el.closest("[data-ink-scroll]");
  const feuille = scroller.firstElementChild;
  const bande = [...feuille.children].filter(
    (c) => c.matches("div[aria-hidden]") && !c.hasAttribute("data-ink-tiles"),
  )[1];
  const largeur = feuille.getBoundingClientRect().width;
  const haut = (bande.getBoundingClientRect().top - feuille.getBoundingClientRect().top) / largeur;
  scroller.scrollTop = haut * largeur;
  await new Promise((r) => requestAnimationFrame(r));

  const r = feuille.getBoundingClientRect();
  const fire = (t, x, y, p, b) =>
    el.dispatchEvent(
      new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
        isPrimary: true, pressure: p, buttons: b,
        clientX: r.left + largeur * x, clientY: r.top + largeur * y,
      }),
    );
  for (const dy of [0.2, 0.36]) {
    const pts = [];
    for (let i = 0; i <= 140; i++) {
      const t = (i / 140) * Math.PI * 5;
      pts.push([0.1 + (t / (Math.PI * 5)) * 0.78, haut + dy + Math.sin(t) * 0.02, 0.5]);
    }
    fire("pointerdown", pts[0][0], pts[0][1], 0.7, 1);
    for (let k = 1; k < pts.length; k++) {
      fire("pointermove", pts[k][0], pts[k][1], 0.7, 1);
      if (k % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", pts.at(-1)[0], pts.at(-1)[1], 0, 0);
    await new Promise((res) => requestAnimationFrame(res));
  }
});
await page.waitForTimeout(1800);

const reponse = await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=flat`);
const octets = Buffer.from(await reponse.body());
writeFileSync("shots/export-avec-fond.pdf", octets);
console.log(`PDF exporté : ${(octets.length / 1024).toFixed(0)} Ko`);

// --- Rendu du PDF, par l'application elle-même ------------------------------
/*
 * Plutôt que de charger pdf.js à la main dans la page — le module n'est pas
 * résoluble depuis le contexte du navigateur —, on réimporte le PDF produit
 * dans une nouvelle note. C'est le moteur de l'application qui le rend, et cela
 * prouve du même coup que l'export se relit.
 */
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles({
  name: "export.pdf",
  mimeType: "application/pdf",
  buffer: octets,
});
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.getByRole("button", { name: "Document", exact: true }).waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);

const pages = await page.evaluate(() => {
  const feuille = document.querySelector("[data-ink-scroll]").firstElementChild;
  const r = feuille.getBoundingClientRect();
  return [...feuille.children]
    .filter((c) => c.matches("div[aria-hidden]") && !c.hasAttribute("data-ink-tiles"))
    .map((c) => {
      const b = c.getBoundingClientRect();
      return { top: (b.top - r.top) / r.width, ratio: b.height / r.width };
    });
});
console.log(`pages relues : ${pages.length}`);

/*
 * On cadre sur la fenêtre, aux deux tiers de chaque page : c'est là que se
 * trouve l'écriture, et c'est le rapport entre l'encre et le réglage qu'on
 * vient juger. Capturer le canevas de la page entière donnait une image plus
 * haute que l'écran, que le navigateur complète avec ce qu'il y a autour.
 */
const largeur = await page.evaluate(
  () => document.querySelector("[data-ink-scroll]").firstElementChild.getBoundingClientRect().width,
);
for (const [index, p] of pages.entries()) {
  await page.evaluate((y) => {
    document.querySelector("[data-ink-scroll]").scrollTop = Math.max(0, y);
  }, (p.top + p.ratio * 0.62) * largeur);
  await page.waitForTimeout(2000);
  await page.locator("[data-ink-scroll]").last().screenshot({ path: `shots/export-page-${index + 1}.png` });
}
console.log("pages du PDF capturées");

await browser.close();
