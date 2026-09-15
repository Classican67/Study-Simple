/*
 * Documents et photos d'une note, sur téléphone.
 *
 * Toutes les captures de pages importées étaient prises en 1194 px de large :
 * rien ne regardait ce qu'il en reste sur un écran de 393 px à trois pixels
 * par point.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const PDF_NOTE = process.env.PDF_NOTE ?? "cmu21nwl6002yycbba58zgzzd";
const PHOTO = process.env.PHOTO ?? "refs/ref-1.png";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const problemes = [];
const DENSITE = 3;

async function mesurer(nom) {
  const m = await page.evaluate(() => {
    const scroller = document.querySelector("[data-ink-scroll]");
    const s = scroller.getBoundingClientRect();
    const pdf = scroller.querySelector('canvas[role="img"][aria-label$="du document importé"]');
    const img = scroller.querySelector("img");
    const pageDiv = (pdf ?? img)?.parentElement.getBoundingClientRect();
    const r = (pdf ?? img)?.getBoundingClientRect();
    return {
      ecran: innerWidth,
      surface: { l: Math.round(s.width), h: Math.round(s.height) },
      page: pageDiv && { l: Math.round(pageDiv.width), h: Math.round(pageDiv.height) },
      pdfDensite: pdf ? +(pdf.width / r.width).toFixed(2) : null,
      imgDensite: img ? +(img.naturalWidth / r.width).toFixed(2) : null,
      imgNaturel: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
  });
  // Part de la page réellement visible : ce que cachent la barre de navigation
  // et la palette ne compte pas.
  m.pageVisible = await page.evaluate(() => {
    const scroller = document.querySelector("[data-ink-scroll]");
    const s = scroller.getBoundingClientRect();
    const nav = [...document.querySelectorAll("nav")]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.bottom >= innerHeight - 1 && r.top > innerHeight / 2)
      .map((r) => r.top);
    const bas = Math.min(innerHeight, s.bottom, ...nav);
    return Math.max(0, Math.round(bas - Math.max(0, s.top)));
  });
  console.log(nom, JSON.stringify(m));
  await page.screenshot({ path: `shots/telephone-${nom}.png` });
  // Le fond doit être rendu à la densité de l'écran, pas aux deux tiers.
  if (m.pdfDensite !== null && m.pdfDensite < DENSITE - 0.05)
    problemes.push(`${nom} : PDF rendu à ${m.pdfDensite} px par point sur un écran à ${DENSITE}`);
  // La surface ne doit pas être plus haute que ce qu'elle porte.
  const pile = await page.evaluate(() =>
    document.querySelector("[data-ink-scroll] > div").getBoundingClientRect().height,
  );
  if (m.surface.h > Math.round(pile) + 2)
    problemes.push(`${nom} : surface de ${m.surface.h} px pour ${Math.round(pile)} px de pages`);

  // Le plein écran, qui est l'endroit où l'on lit vraiment.
  await page.getByRole("button", { name: /plein écran/i }).first().click();
  await page.waitForTimeout(1500);
  const plein = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll("[data-ink-scroll]")].at(-1);
    const s = scroller.getBoundingClientRect();
    const pal = document.querySelector('.fixed [role="toolbar"]')?.getBoundingClientRect();
    return { surface: { l: Math.round(s.width), h: Math.round(s.height) }, palette: pal && Math.round(pal.height) };
  });
  console.log(`${nom} plein écran`, JSON.stringify(plein));
  // Rien d'extérieur ne doit recouvrir la palette : sous le centre de chaque
  // bouton, l'élément du dessus doit appartenir à la palette. « Le bouton
  // lui-même » serait trop strict : un bouton désactivé laisse passer le
  // pointeur (`pointer-events: none`), et `elementFromPoint` rend alors son
  // groupe — ce qui a fait accuser Annuler et Rétablir, grisés sur une page neuve.
  const recouverts = await page.evaluate(() => {
    const palette = document.querySelector('.fixed [role="toolbar"]');
    return [...palette.querySelectorAll("button")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0) return false;
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !palette.contains(dessus);
      })
      .map((b) => {
        const r = b.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return `${b.getAttribute("aria-label") ?? b.title ?? "?"} sous ${dessus?.closest("nav,button,div")?.getAttribute("aria-label") ?? dessus?.tagName}`;
      });
  });
  for (const r of recouverts) problemes.push(`${nom} plein écran : ${r}`);
  // Le repère de page ne doit pas laisser d'enveloppe vide sur la feuille
  // quand il n'a rien à montrer.
  const enveloppesVides = await page.evaluate(
    () =>
      [...document.querySelectorAll(".fixed.z-50 > .rounded-full")].filter((el) => {
        const r = el.getBoundingClientRect();
        return el.childElementCount === 0 && r.width > 0 && r.height > 0;
      }).length,
  );
  if (enveloppesVides > 0) problemes.push(`${nom} plein écran : repère de page vide mais visible`);
  await page.screenshot({ path: `shots/telephone-${nom}-plein.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  return m;
}

// Un document importé.
await page.goto(`${BASE}/notes/${PDF_NOTE}`, { waitUntil: "networkidle" });
await page.locator("[data-ink-scroll]").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await mesurer("document");

// Une photo.
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Photo téléphone ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await retirerPageVierge(page);
await page.locator('input[type="file"][accept="image/*"]:not([data-page-image])').setInputFiles(PHOTO);
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Utiliser" }).click();
await page.waitForSelector("[data-ink-scroll] img");
await page.locator("[data-ink-scroll]").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2000);
await mesurer("photo");

await browser.close();
console.log(problemes.length ? problemes.map((p) => `  ${p}`).join("\n") : "Documents et photos lisibles sur téléphone.");
process.exit(problemes.length ? 1 : 0);


/**
 * Une note neuve s'ouvre sur une page manuscrite vierge. Ce scénario veut une
 * note dont la première page est la photo : on retire d'abord la page vierge.
 */
async function retirerPageVierge(page) {
  await page.getByRole("button", { name: "Supprimer le bloc 1" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.locator("section[aria-label^='Bloc']").first().waitFor({ state: "detached" });
}
