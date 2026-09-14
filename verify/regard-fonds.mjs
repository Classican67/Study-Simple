/*
 * Captures des quatre fonds de page, en clair et en sombre.
 *
 * Les mesures disent que l'interligne fait sept millimètres et que la bonne
 * classe est posée. Elles ne disent pas si l'on a envie d'écrire dessus : trop
 * pâle, le réglage disparaît ; trop marqué, il passe devant l'écriture.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();

/** Une ligne d'écriture plausible, à la hauteur `y` de la page. */
const mot = (y, x0 = 0.1, largeur = 0.78) => {
  const pts = [];
  for (let i = 0; i <= 180; i++) {
    const t = (i / 180) * Math.PI * 6;
    pts.push([
      x0 + (t / (Math.PI * 6)) * largeur,
      y + Math.sin(t) * 0.022 + Math.sin(t * 2.3) * 0.008,
      0.4 + 0.4 * Math.abs(Math.sin(t * 0.7)),
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
  await page.getByLabel("Titre de la note").fill(`Fonds ${theme} ${Date.now()}`);
  await page.getByLabel("Titre de la note").blur();
  await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(800);

  // Deux lignes d'écriture, pour juger le rapport entre l'encre et le réglage.
  for (const y of [0.18, 0.34]) {
    await page.evaluate(
      async ({ pts }) => {
        const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
        const feuille = el.closest("[data-ink-scroll]").firstElementChild;
        const r = feuille.getBoundingClientRect();
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
      { pts: mot(y) },
    );
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(900);

  const bloc = page.locator("[data-ink-scroll]").last();
  for (const [bouton, nom] of [
    ["Uni", "uni"],
    ["Lignes", "lignes"],
    ["Carreaux", "carreaux"],
    ["Points", "points"],
  ]) {
    await page.getByRole("button", { name: bouton, exact: true }).click();
    await page.waitForTimeout(600);
    await bloc.screenshot({ path: `shots/fond-${nom}-${theme}.png` });
  }
  console.log(`${theme} : quatre fonds capturés`);
  await ctx.close();
}

await browser.close();
