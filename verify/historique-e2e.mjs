/*
 * Historique de la page manuscrite : Annuler rend ce que la dernière action a
 * changé — pas « le dernier trait ».
 *
 * Annuler retirait le dernier trait de la liste, quelle que soit l'action
 * annulée. Après un coup de gomme, il effaçait donc un trait de plus au lieu de
 * rendre celui qu'on venait de gommer ; après « Effacer toute la page », il n'y
 * avait plus rien à retirer, et la page restait perdue.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Historique ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.getByRole("button", { name: "Croquis" }).first().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(800);

const canvas = page.locator('[data-testid="drawing-canvas"]').last();
const traits = async () =>
  Number((await canvas.getAttribute("aria-label")).match(/(\d+) trait/)?.[1] ?? 0);

/** Un geste au stylet, en fractions de la largeur de la page. */
async function geste(points) {
  await canvas.evaluate(async (el, pts) => {
    const r = el.getBoundingClientRect();
    const fire = (t, [x, y], p, b) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
          pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * y,
        }),
      );
    fire("pointerdown", pts[0], 0.5, 1);
    for (let i = 1; i < pts.length; i++) {
      fire("pointermove", pts[i], 0.45 + Math.sin(i) * 0.1, 1);
      if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", pts.at(-1), 0, 0);
  }, points);
  await page.waitForTimeout(120);
}
const ligne = (y) => Array.from({ length: 24 }, (_, i) => [0.15 + i * 0.025, y + (i % 2) * 0.002]);

const annuler = page.getByRole("button", { name: /^Annuler/ });
const retablir = page.getByRole("button", { name: /^Rétablir/ });

check(await annuler.isDisabled(), "rien à annuler sur une page neuve : Annuler est désactivé");

await page.getByRole("button", { name: "Stylo" }).click();
await geste(ligne(0.1));
await geste(ligne(0.2));
await geste(ligne(0.3));
check((await traits()) === 3, "trois traits posés", `${await traits()}`);

// La gomme retire le trait du milieu ; Annuler doit le rendre, pas en retirer un autre.
await page.getByRole("button", { name: "Gomme" }).click();
await geste(Array.from({ length: 10 }, (_, i) => [0.3, 0.17 + i * 0.006]));
check((await traits()) === 2, "la gomme retire un trait", `${await traits()}`);
await annuler.click();
await page.waitForTimeout(150);
check((await traits()) === 3, "Annuler après la gomme rend le trait gommé", `${await traits()} trait(s)`);
await retablir.click();
await page.waitForTimeout(150);
check((await traits()) === 2, "Rétablir refait le coup de gomme", `${await traits()} trait(s)`);
await annuler.click();
await page.waitForTimeout(150);

// Effacer toute la page, puis Annuler : tout revient d'un coup.
await page.getByRole("button", { name: "Effacer toute la page" }).click();
await page.waitForTimeout(150);
check((await traits()) === 0, "la page est effacée", `${await traits()}`);
await annuler.click();
await page.waitForTimeout(150);
check((await traits()) === 3, "Annuler rend toute la page effacée, d'un seul geste", `${await traits()} trait(s)`);

// Un trait neuf rend l'avenir caduc : Rétablir n'a plus rien à refaire.
await page.getByRole("button", { name: "Stylo" }).click();
await geste(ligne(0.4));
check(await retablir.isDisabled(), "après un trait neuf, Rétablir est désactivé");

// Toucher la page de plusieurs doigts, sans glisser : deux annulent, trois rétablissent.
async function toucher(doigts, glisse = 0) {
  await canvas.evaluate(
    (el, [n, dx]) => {
      const r = el.getBoundingClientRect();
      const fire = (type, id) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 40 + id, pointerType: "touch", isPrimary: id === 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: r.left + 120 + id * 60 + (type === "pointerdown" ? 0 : dx), clientY: r.top + 120,
          }),
        );
      for (let i = 0; i < n; i++) fire("pointerdown", i);
      if (dx) for (let i = 0; i < n; i++) fire("pointermove", i);
      for (let i = 0; i < n; i++) fire("pointerup", i);
    },
    [doigts, glisse],
  );
  await page.waitForTimeout(200);
}
await toucher(2);
check((await traits()) === 3, "deux doigts tapés annulent le dernier trait", `${await traits()} trait(s)`);
await toucher(3);
check((await traits()) === 4, "trois doigts tapés le rétablissent", `${await traits()} trait(s)`);
await toucher(2, 40);
check((await traits()) === 4, "deux doigts qui glissent défilent, sans rien annuler", `${await traits()} trait(s)`);

// La paume se pose, la pointe touche, la paume se relève aussitôt : ce n'est pas
// un toucher à deux doigts, et rien ne doit être annulé pendant qu'on écrit.
await canvas.evaluate(async (el) => {
  const r = el.getBoundingClientRect();
  const doigt = (type, id) =>
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 60 + id, pointerType: "touch", isPrimary: id === 0,
      buttons: type === "pointerup" ? 0 : 1, clientX: r.left + 300 + id * 40, clientY: r.top + 260,
    }));
  const pointe = (type, x, p, b) =>
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 8, pointerType: "pen", isPrimary: true,
      pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * 0.5,
    }));
  doigt("pointerdown", 0);
  doigt("pointerdown", 1);
  pointe("pointerdown", 0.15, 0.5, 1);
  doigt("pointerup", 0);
  doigt("pointerup", 1);
  for (let i = 1; i < 24; i++) {
    pointe("pointermove", 0.15 + i * 0.02, 0.45 + Math.sin(i) * 0.1, 1);
    if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
  }
  pointe("pointerup", 0.6, 0, 0);
});
await page.waitForTimeout(250);
check((await traits()) === 5, "la paume relevée pendant l'écriture n'annule rien", `${await traits()} trait(s), 5 attendus`);
// Sans le correctif, l'annulation involontaire faisait perdre des traits —
// mesuré à 3 au lieu de 5, et encore 3 après rechargement. Annuler, juste
// après, vérifie en plus que l'historique n'a sauté aucune version.
await annuler.click();
await page.waitForTimeout(150);
check((await traits()) === 4, "Annuler retire ensuite ce trait-là, et lui seul", `${await traits()} trait(s), 4 attendus`);
await retablir.click();
await page.waitForTimeout(150);
check((await traits()) === 5, "que Rétablir remet", `${await traits()} trait(s)`);

// L'anneau de la gomme : il se montre sous la pointe, et disparaît quand elle part.
await page.getByRole("button", { name: "Gomme" }).click();
const boite = await canvas.boundingBox();
const anneau = () =>
  canvas.evaluate((el, [x, y]) => {
    const d = el.width / el.getBoundingClientRect().width;
    const r = Math.round(40 * d);
    const px = el.getContext("2d").getImageData(Math.round(x * d) - r, Math.round(y * d) - r, 2 * r, 2 * r).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
    return n;
  }, [boite.width * 0.5, 150]);
await page.mouse.move(boite.x + boite.width * 0.5, boite.y + 150);
await page.waitForTimeout(200);
const vu = await anneau();
check(vu > 50, "la gomme montre son anneau sous la pointe", `${vu} px peints`);
await page.mouse.move(boite.x + boite.width * 0.5, boite.y - 60);
await page.waitForTimeout(200);
const reste = await anneau();
check(reste === 0, "et le range quand la pointe quitte la page", `${reste} px peints`);

// Et l'historique survit à ce qui est enregistré : la page rechargée a bien 5 traits.
await page.waitForTimeout(1500);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="drawing-canvas"]');
check((await traits()) === 5, "l'état final est celui qui est enregistré", `${await traits()} trait(s)`);

await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nHistorique fidèle.");
process.exit(echecs ? 1 : 0);
