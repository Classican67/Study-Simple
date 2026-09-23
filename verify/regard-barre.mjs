/*
 * La barre d'outils, regardée.
 *
 * Les instruments sont dessinés, et un dessin ne se vérifie pas à la mesure :
 * on peut prouver qu'un bouton fait 44 px et que son contraste passe, et
 * découvrir en ouvrant la capture que le crayon et le stylo ont exactement la
 * même silhouette. D'où ces prises de vue — en ligne et en plein écran, aux
 * quatre bords, repliée en bulle, en clair et en sombre.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const browser = await chromium.launch();

async function ouvrir(vp, dark, dsf = 2) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: dsf,
    hasTouch: true,
    colorScheme: dark ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   erreur page :", String(e).slice(0, 160)));
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(500);
  return { ctx, page };
}

const nom = (t) => `shots/barre-${t}.png`;

for (const [etiquette, vp, dark] of [
  ["ligne-clair", { width: 1194, height: 900 }, false],
  ["ligne-sombre", { width: 1194, height: 900 }, true],
  ["ligne-telephone", { width: 393, height: 852 }, false],
]) {
  const { ctx, page } = await ouvrir(vp, dark);
  await page.locator('[role="toolbar"]').first().screenshot({ path: nom(etiquette) });
  await ctx.close();
}

// Plein écran : la barre flotte, se déplace et se replie.
for (const [etiquette, vp, dark] of [
  ["plein-clair", { width: 1194, height: 900 }, false],
  ["plein-sombre", { width: 1194, height: 900 }, true],
  ["plein-telephone", { width: 393, height: 852 }, false],
]) {
  const { ctx, page } = await ouvrir(vp, dark);
  await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: nom(etiquette) });

  // Collée à gauche : elle devient une colonne.
  await page.getByRole("button", { name: "Déplacer la barre d'outils" }).click();
  await page.getByRole("menuitemradio", { name: "À gauche" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: nom(`${etiquette}-gauche`) });

  // Repliée en bulle.
  await page.getByRole("button", { name: "Réduire les outils en bulle" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: nom(`${etiquette}-bulle`) });
  await ctx.close();
}

await browser.close();
console.log("captures : shots/barre-*.png");
