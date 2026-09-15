/*
 * Captures des menus contextuels, de la pastille « maîtrisée » et du fil
 * d'Ariane des notes : téléphone et desktop, clair et sombre. À **ouvrir** —
 * `menus-e2e.mjs` dit que les options marchent, pas que le menu est lisible.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();

// Une note marquée et rangée dans un dossier, pour voir la pastille et le fil.
const noteId = sql(`select id from Note order by updatedAt desc limit 1;`);
const dossier = sql(`select id from Folder where kind='note' limit 1;`);
sql(`update Note set mastered=1 where id='${noteId}';`);

const browser = await chromium.launch();
for (const [appareil, viewport] of [["telephone", { width: 393, height: 852 }], ["desktop", { width: 1280, height: 860 }]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
    await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    const nom = `${appareil}-${theme === "dark" ? "sombre" : "clair"}`;

    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await page.locator(`a[href="/notes/${noteId}"]`).scrollIntoViewIfNeeded();
    await page.locator(`button[aria-label^="Options de la note"]`).first().click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/menus-note-${nom}.png` });
    await page.keyboard.press("Escape");

    await page.goto(`${BASE}/notes?vue=list`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `shots/menus-liste-${nom}.png` });

    if (dossier) {
      await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
      await page.locator(`button[aria-label^="Options du dossier"]`).first().click();
      await page.getByRole("menu").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `shots/menus-dossier-${nom}.png` });
    }

    await page.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/menus-page-note-${nom}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 260 } });
    await ctx.close();
  }
}
await browser.close();
console.log("Captures dans shots/menus-*.png");
