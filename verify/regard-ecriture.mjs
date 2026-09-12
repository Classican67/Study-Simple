/*
 * Captures de l'écriture : à taille normale, agrandie, en clair et en sombre.
 *
 * Les mesures disent que le trait fait la bonne épaisseur et que les pixels
 * sont là. Elles ne disent pas si l'encre a l'air d'une encre.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();

/** Une écriture plausible : des boucles, des déliés, des pressions qui varient. */
const mot = (x0, y0, echelle) => {
  const pts = [];
  for (let i = 0; i <= 220; i++) {
    const t = (i / 220) * Math.PI * 7;
    pts.push([
      x0 + (t / (Math.PI * 7)) * echelle,
      y0 + Math.sin(t) * echelle * 0.11 + Math.sin(t * 2.7) * echelle * 0.03,
      0.35 + 0.45 * Math.abs(Math.sin(t * 0.6)),
    ]);
  }
  return pts;
};

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
  await page.getByLabel("Titre de la note").fill(`Regard ${theme} ${Date.now()}`);
  await page.getByLabel("Titre de la note").blur();
  await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(700);

  // Trois lignes d'écriture, plus un surlignage par-dessus l'une d'elles.
  for (const [i, y] of [0.13, 0.26, 0.39].entries()) {
    await page.evaluate(
      async ({ pts }) => {
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
        fire("pointerdown", pts[0][0], pts[0][1], pts[0][2], 1);
        for (let k = 1; k < pts.length; k++) {
          fire("pointermove", pts[k][0], pts[k][1], pts[k][2], 1);
          if (k % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
        }
        fire("pointerup", pts.at(-1)[0], pts.at(-1)[1], 0, 0);
      },
      { pts: mot(0.07, y, 0.86 - i * 0.06) },
    );
    await page.waitForTimeout(500);
  }

  await page.getByRole("button", { name: "Surligneur", exact: true }).first().click();
  await page.waitForTimeout(300);
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
    fire("pointerdown", 0.08, 0.26, 0.7, 1);
    for (let k = 1; k <= 40; k++) {
      fire("pointermove", 0.08 + (0.7 * k) / 40, 0.26, 0.7, 1);
      if (k % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", 0.78, 0.26, 0, 0);
  });
  await page.waitForTimeout(1400);

  const bloc = page.locator("[data-ink-scroll]").last();
  await bloc.screenshot({ path: `shots/ecriture-${theme}-1x.png` });

  // Puis agrandie : c'est là que le crénelage se voyait.
  await page.evaluate(async () => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width * 0.3;
    const cy = r.top + r.width * 0.14;
    const fire = (t, id, x, y, b) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
          isPrimary: id === 1, pressure: 0.5, buttons: b, clientX: x, clientY: y,
        }),
      );
    fire("pointerdown", 1, cx - 40, cy, 1);
    fire("pointerdown", 2, cx + 40, cy, 1);
    for (let i = 1; i <= 14; i++) {
      const d = 40 + (170 - 40) * (i / 14);
      fire("pointermove", 1, cx - d, cy, 1);
      fire("pointermove", 2, cx + d, cy, 1);
      await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", 1, cx - 170, cy, 0);
    fire("pointerup", 2, cx + 170, cy, 0);
  });
  await page.waitForTimeout(1200);
  await bloc.screenshot({ path: `shots/ecriture-${theme}-zoom.png` });
  const zoom = await page.getByRole("button", { name: /Zoom \d+ %/ }).innerText().catch(() => "?");
  console.log(`${theme} : capturé à 1× et à ${zoom.replace(/\s+/g, " ").trim()}`);
  await ctx.close();
}

await browser.close();
