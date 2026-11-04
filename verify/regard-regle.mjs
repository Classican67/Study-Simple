/*
 * La règle, regardée.
 *
 * Elle était un rectangle violet à douze pour cent : un voile coloré posé sur
 * l'écriture, avec vingt traits régulièrement espacés qui ne mesuraient rien.
 * Une règle se juge à trois choses qu'aucune mesure ne donne — voit-on la page
 * au travers, les graduations ressemblent-elles à des millimètres, et
 * devine-t-on qu'on peut la tourner.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const browser = await chromium.launch();

for (const sombre of [false, true]) {
  const ctx = await browser.newContext({
    viewport: { width: 1194, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
    colorScheme: sombre ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.getByLabel("Titre de la note").fill(`Règle ${Date.now()}`);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(500);

  // De l'écriture **sous** la règle : c'est là qu'un voile coloré se voit.
  await page.evaluate(async () => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    const fire = (t, x, y, p, b) =>
      el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: "pen",
        isPrimary: true, pressure: p, buttons: b,
        clientX: r.left + r.width * x, clientY: r.top + r.width * y,
      }));
    const attendre = (j) => { while (performance.now() < j) { /* cadence */ } };
    for (const y of [0.16, 0.2, 0.24]) {
      const t0 = performance.now();
      fire("pointerdown", 0.1, y, 0.6, 1);
      for (let i = 1; i <= 60; i++) {
        attendre(t0 + i * 4);
        fire("pointermove", 0.1 + 0.7 * (i / 60), y + Math.sin(i / 4) * 0.008, 0.6, 1);
      }
      fire("pointerup", 0.8, y, 0, 0);
      await new Promise((res) => requestAnimationFrame(res));
    }
  });
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "Poser la règle" }).first().click();
  await page.waitForTimeout(500);
  await page.locator("[data-ink-scroll]").first().screenshot({
    path: `shots/regle-${sombre ? "sombre" : "clair"}.png`,
  });
  await ctx.close();
}
await browser.close();
console.log("captures : shots/regle-*.png");
