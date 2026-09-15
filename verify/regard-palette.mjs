/*
 * Barre d'outils de la page manuscrite, à regarder : téléphone et desktop, clair
 * et sombre, avec le stylo, le surligneur et la gomme (anneau compris).
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const ecrans = [
  ["iphone", 393, 852],
  ["desktop", 1280, 900],
];

const browser = await chromium.launch();
for (const [ecran, width, height] of ecrans) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
    await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nouvelle note" }).first().click();
    await page.waitForURL(/\/notes\/[a-z0-9]+/);
    await page.getByLabel("Titre de la note").fill(`Palette ${ecran} ${theme} ${Date.now()}`);
    await page.getByLabel("Titre de la note").blur();
    await page.getByRole("button", { name: "Croquis" }).first().click();
    const canvas = page.locator('[data-testid="drawing-canvas"]').last();
    await canvas.waitFor();
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    // Quelques mots au stylet, et un surlignage, pour que la page ne soit pas vide.
    await canvas.evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const trace = async (pts, id) => {
        const fire = (t, [x, y], p, b) =>
          el.dispatchEvent(new PointerEvent(t, {
            bubbles: true, cancelable: true, pointerId: id, pointerType: "pen", isPrimary: true,
            pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * y,
          }));
        fire("pointerdown", pts[0], 0.5, 1);
        for (let i = 1; i < pts.length; i++) {
          fire("pointermove", pts[i], 0.4 + Math.abs(Math.sin(i / 3)) * 0.35, 1);
          if (i % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
        }
        fire("pointerup", pts.at(-1), 0, 0);
      };
      for (let l = 0; l < 3; l++) {
        await trace(
          Array.from({ length: 70 }, (_, i) => [0.08 + i * 0.011, 0.08 + l * 0.08 + Math.sin(i / 2.2) * 0.012]),
          10 + l,
        );
      }
    });
    await page.waitForTimeout(400);

    const bloc = page.locator("section").filter({ has: canvas });
    await bloc.screenshot({ path: `shots/palette-${ecran}-${theme}-stylo.png` });

    await page.getByRole("button", { name: "Surligneur" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("toolbar", { name: "Outils d'écriture" }).screenshot({ path: `shots/palette-${ecran}-${theme}-surligneur.png` });

    await page.getByRole("button", { name: "Gomme" }).click();
    const boite = await canvas.boundingBox();
    await page.mouse.move(boite.x + boite.width * 0.3, boite.y + boite.width * 0.1);
    await page.waitForTimeout(300);
    await bloc.screenshot({ path: `shots/palette-${ecran}-${theme}-gomme.png` });

    console.log(`${ecran} ${theme} : capturé`);
    await ctx.close();
  }
}
await browser.close();
