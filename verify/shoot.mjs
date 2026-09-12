/*
 * Captures d'écran + détection de débordement HORIZONTAL et d'erreurs console.
 *
 * Le débordement vertical est mesuré séparément par hauteur.mjs : c'est une
 * garantie propre à l'écran de révision, alors qu'une page qui défile
 * verticalement est normale partout ailleurs.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token, deckId, folderId, noteFolderId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const problemes = [];
const ecrans = [
  ["iphone", 393, 852],
  ["ipad", 1024, 1366],
  ["desktop", 1440, 900],
];
const pages = [
  ["accueil", "/"],
  ["paquet", `/decks/${deckId}`],
  ["revision", `/decks/${deckId}/study?all=1`],
  ["ecrire", `/decks/${deckId}/study?all=1&mode=write`],
  ["jour", "/study"],
  ["notes", "/notes"],
  ["dossier", folderId ? `/folders/${folderId}` : "/"],
  // Les deux classements sont séparés : le dossier de notes a sa propre page.
  ["dossier-notes", noteFolderId ? `/notes?folder=${noteFolderId}` : "/notes"],
  ["connexion", "/login"],
];

const browser = await chromium.launch();

for (const [ecran, width, height] of ecrans) {
  for (const sombre of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      colorScheme: sombre ? "dark" : "light",
    });
    await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();

    for (const [nom, url] of pages) {
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 120)));
      page.on("console", (m) => {
        if (m.type() === "error") erreurs.push(m.text().slice(0, 120));
      });

      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);

      const debord = await page.evaluate(() => {
        const d = document.documentElement;
        const largeur = d.scrollWidth - d.clientWidth;
        if (largeur <= 1) return null;
        const coupable = [...document.querySelectorAll("*")].find(
          (el) => el.getBoundingClientRect().right > d.clientWidth + 1,
        );
        return {
          largeur,
          coupable: coupable ? coupable.tagName + "." + (coupable.className || "").slice(0, 40) : "?",
        };
      });

      const etiquette = `${nom} ${ecran} ${sombre ? "sombre" : "clair"}`;
      if (debord) problemes.push(`  [débordement] ${etiquette} : ${debord.largeur} px — ${debord.coupable}`);
      for (const e of erreurs) problemes.push(`  [console]     ${etiquette} : ${e}`);

      if (!sombre) await page.screenshot({ path: `shots/${nom}-${ecran}.png` });
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
    }
    await ctx.close();
  }
}

await browser.close();
console.log(problemes.length ? problemes.join("\n") : "Aucun débordement ni erreur console.");
process.exit(problemes.length ? 1 : 0);
