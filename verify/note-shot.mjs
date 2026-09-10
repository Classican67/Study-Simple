/* Capture de l'éditeur de note, et vérification que la barre supérieure
   collante ne recouvre pas le titre. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch();
let ko = 0;
for (const [nom, w, h] of [["iphone", 393, 852], ["ipad", 1024, 1366]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.locator('a[href^="/notes/"]').first().click();
  await page.waitForSelector("section[aria-label^='Bloc']");
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const titre = document.querySelector('[aria-label="Titre de la note"]');
    const barre = document.querySelector("header");
    const t = titre.getBoundingClientRect();
    const b = barre ? barre.getBoundingClientRect() : { bottom: 0 };
    return { titreHaut: Math.round(t.top), barreBas: Math.round(b.bottom) };
  });
  const recouvert = m.titreHaut < m.barreBas;
  if (recouvert) ko++;
  console.log(`${nom.padEnd(8)} titre à ${m.titreHaut}, barre finit à ${m.barreBas} → ${recouvert ? "⚠️ recouvert" : "dégagé"}`);
  await page.screenshot({ path: `shots/note-${nom}.png` });
  await ctx.close();
}
await browser.close();
process.exit(ko === 0 ? 0 : 1);
