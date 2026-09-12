/* Captures ciblées : le document empilé, le volet de pages, la gomme. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const b = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const c = await b.newContext({
    viewport: { width: 1194, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await c.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const p = await c.newPage();
  await p.goto("http://localhost:3100/notes", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Nouvelle note" }).click();
  await p.waitForURL(/\/notes\/[a-z0-9]+/);
  await p.getByLabel("Titre de la note").fill(`Regard ${theme}`);
  await p.getByLabel("Titre de la note").blur();
  await p.locator('input[type="file"][accept*=".pdf"]').setInputFiles("doc-test.pdf");
  await p.waitForTimeout(8000);
  // En plein écran, comme on annote vraiment, au raccord des deux pages.
  await p.getByRole("button", { name: "Écrire en plein écran" }).click();
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const s = document.querySelector("[data-ink-scroll]");
    s.scrollTop = 1.27 * s.clientWidth;
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `shots/doc-raccord-${theme}.png` });
  // Le volet de pages ouvert.
  await p.getByRole("button", { name: /Choisir une page/ }).click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `shots/volet-pages-${theme}.png` });
  await c.close();
}
await b.close();
console.log("captures prises");
