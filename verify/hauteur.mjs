/*
 * La révision doit tenir dans l'écran : c'est une garantie, pas une préférence.
 * `shoot.mjs` ne voit que le débordement horizontal — c'est ce qui a laissé
 * passer 70 à 227 px de dépassement vertical selon l'appareil.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token, deckId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const ecrans = [
  ["iPhone 15", 393, 852],
  ["iPad 11 portrait", 834, 1194],
  ["iPad 11 paysage", 1194, 834],
  ["iPad mini paysage", 1133, 744],
  ["portable", 1440, 900],
];
const pages = [
  ["cartes", `/decks/${deckId}/study?all=1`],
  ["écrire", `/decks/${deckId}/study?all=1&mode=write`],
];

const browser = await chromium.launch();
let debordements = 0;
console.log("écran               page     viewport  contenu  débordement  carte");

for (const [nom, w, h] of ecrans) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  for (const [label, url] of pages) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const carte = document.querySelector(".perspective") ?? document.querySelector('[class*="elevation-3"]');
      const r = carte?.getBoundingClientRect();
      return {
        contenu: document.documentElement.scrollHeight,
        vue: document.documentElement.clientHeight,
        carte: r ? Math.round(r.height) : 0,
      };
    });
    const debord = m.contenu - m.vue;
    if (debord > 0) debordements++;
    console.log(
      `${nom.padEnd(19)} ${label.padEnd(8)} ${String(m.vue).padStart(6)}  ${String(m.contenu).padStart(7)}  ${
        debord > 0 ? `⚠️ ${String(debord).padStart(4)} px` : "      —   "
      }  ${String(m.carte).padStart(5)} px`,
    );
    await page.screenshot({ path: `shots/etude-${nom.replace(/ /g, "-")}-${label}.png` });
  }
  await ctx.close();
}

await browser.close();
console.log(
  debordements === 0
    ? "\nLa révision tient dans l'écran partout."
    : `\n${debordements} écran(s) débordent.`,
);
process.exit(debordements === 0 ? 0 : 1);
