/*
 * Les neuf instruments, écrits.
 *
 * Une mesure dit qu'un crayon est plus pâle qu'un stylo et que son bord
 * tremble ; elle ne dit pas qu'il a l'air d'un crayon. Cette capture écrit la
 * même ondulation avec chacun, en grand, et se regarde.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const INSTRUMENTS = [
  ["Plume", 0.05],
  ["Stylo", 0.11],
  ["Monoline", 0.17],
  ["Crayon", 0.23],
  ["Crayon de cire", 0.29],
  ["Pinceau", 0.36],
  ["Aquarelle", 0.43],
  ["Feutre", 0.5],
  ["Surligneur", 0.58],
];

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
  await page.getByLabel("Titre de la note").fill(`Instruments ${Date.now()}`);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(600);

  for (const [nom, y] of INSTRUMENTS) {
    await page.getByRole("button", { name: nom, exact: true }).first().click();
    // L'épaisseur du milieu ne montre rien : on prend la plus grosse, c'est là
    // que la matière d'un instrument se voit ou ne se voit pas.
    await page.getByRole("button", { name: "Épais", exact: true }).first().click();
    await page.waitForTimeout(120);
    await page.evaluate(
      async ({ y }) => {
        const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
        const r = el.getBoundingClientRect();
        const fire = (t, x, yy, p, b) =>
          el.dispatchEvent(
            new PointerEvent(t, {
              bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen",
              isPrimary: true, pressure: p, buttons: b,
              clientX: r.left + r.width * x, clientY: r.top + r.width * yy,
            }),
          );
        const attendre = (j) => { while (performance.now() < j) { /* cadence réelle */ } };
        // Une main : la pression monte, redescend, et le geste ondule.
        const n = 150;
        const t0 = performance.now();
        const pos = (i) => {
          const t = i / n;
          return [0.06 + 0.86 * t, y + Math.sin(t * 11) * 0.022 + Math.sin(t * 31) * 0.004];
        };
        const pression = (i) => 0.25 + 0.6 * Math.sin((i / n) * Math.PI) + 0.08 * Math.sin(i / 5);
        fire("pointerdown", ...pos(0), pression(0), 1);
        for (let i = 1; i <= n; i++) {
          attendre(t0 + i * 5);
          fire("pointermove", ...pos(i), pression(i), 1);
        }
        fire("pointerup", ...pos(n), 0, 0);
        await new Promise((res) => requestAnimationFrame(res));
      },
      { y },
    );
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(900);
  const surface = page.locator("[data-ink-scroll]").first();
  await surface.screenshot({ path: `shots/instruments-${sombre ? "sombre" : "clair"}.png` });
  await ctx.close();
}
await browser.close();
console.log("captures : shots/instruments-*.png");
