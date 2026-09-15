/* Une photo annotée, en clair et en sombre : l'encre doit se détacher. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1194, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.getByLabel("Titre de la note").fill(`Photo annotée ${theme}`);
  await page.getByLabel("Titre de la note").blur();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles("photo.png");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Utiliser" }).click();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(2000);

  // Deux annotations : un entourage et une flèche, le geste réel.
  await page.evaluate(async () => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    const fire = (t, x, y, p, b) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: p, buttons: b,
          clientX: r.left + r.width * x, clientY: r.top + r.width * y,
        }),
      );
    const tracer = async (pts) => {
      fire("pointerdown", pts[0][0], pts[0][1], 0.5, 1);
      for (let i = 1; i < pts.length; i++) {
        fire("pointermove", pts[i][0], pts[i][1], 0.45 + Math.sin(i / 7) * 0.15, 1);
        if (i % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
      }
      fire("pointerup", pts.at(-1)[0], pts.at(-1)[1], 0, 0);
      await new Promise((res) => requestAnimationFrame(res));
    };
    // Un cercle autour d'une zone.
    await tracer(
      Array.from({ length: 50 }, (_, i) => {
        const a = (i / 49) * Math.PI * 2;
        return [0.32 + Math.cos(a) * 0.13, 0.3 + Math.sin(a) * 0.11];
      }),
    );
    // Une flèche qui y mène.
    await tracer([[0.7, 0.52], [0.62, 0.46], [0.54, 0.40], [0.48, 0.36]]);
    await tracer([[0.48, 0.36], [0.53, 0.37]]);
    await tracer([[0.48, 0.36], [0.50, 0.41]]);
  });
  await page.waitForTimeout(1600);
  await page.locator("[data-ink-scroll]").last().screenshot({ path: `shots/photo-annotee-${theme}.png` });
  console.log(`${theme} : capturé`);
  await ctx.close();
}
await browser.close();
