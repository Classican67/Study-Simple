/*
 * Roue chromatique : une couleur libre, du choix jusqu'au PDF.
 *
 * Ce qui compte n'est pas que la roue s'ouvre, c'est que la couleur choisie soit
 * **celle qui est peinte** — sur les tuiles, après rechargement, dans le PDF
 * exporté et en thème sombre. La mesure lit donc les pixels des couches et le
 * contenu du PDF, pas l'état de l'interface.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const CIBLE = "#d9480f";
const RVB = [217, 72, 15];
mkdirSync("shots", { recursive: true });

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}
const proche = (a, b, tol = 6) => a && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const browser = await chromium.launch();

async function contexte(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2, ...options });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  return ctx;
}

/** Couleur des pixels pleinement opaques des tuiles d'encre : les bords lissés sont écartés. */
async function encrePeinte(page) {
  return page.evaluate(() => {
    let n = 0;
    const somme = [0, 0, 0];
    for (const canvas of document.querySelectorAll("[data-ink-tiles] canvas")) {
      if (!canvas.width || !canvas.height) continue;
      const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 255) {
          somme[0] += px[i];
          somme[1] += px[i + 1];
          somme[2] += px[i + 2];
          n++;
        }
      }
    }
    return n ? somme.map((v) => Math.round(v / n)) : null;
  });
}

const ctx = await contexte();
const page = await ctx.newPage();
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/notes/")[1].split(/[?#]/)[0];
await page.getByLabel("Titre de la note").fill(`Couleur libre ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
// Une note neuve porte déjà sa page manuscrite : ajouter un croquis en ferait deux.
const canvas = page.locator('[data-testid="drawing-canvas"]').last();
await canvas.waitFor();
await page.waitForTimeout(600);

// --- La roue --------------------------------------------------------------
const bouton = page.getByRole("button", { name: "Autre couleur" }).first();
check((await bouton.getAttribute("aria-pressed")) === "false", "aucune couleur libre au départ");
await bouton.click();
const roue = page.getByRole("dialog", { name: "Choisir une couleur" });
await roue.waitFor();
check(await roue.isVisible(), "« Autre couleur » ouvre la roue");

const teinte = roue.getByRole("slider", { name: "Teinte" });
const avant = Number(await teinte.getAttribute("aria-valuenow"));
await teinte.focus();
await page.keyboard.press("ArrowRight");
const apres = Number(await teinte.getAttribute("aria-valuenow"));
check((apres - avant + 360) % 360 === 5, "la teinte se règle au clavier", `${avant}° → ${apres}°`);

// Un appui sur l'anneau, à droite : 90° depuis le haut, dans le sens du dégradé.
const zone = await teinte.evaluate((el) => {
  const r = el.parentElement.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width };
});
await page.mouse.move(zone.x + zone.w - 16, zone.y + zone.w / 2);
await page.mouse.down();
await page.mouse.up();
const auGeste = Number(await teinte.getAttribute("aria-valuenow"));
check(Math.abs(auGeste - 90) <= 3, "et au geste, là où l'on touche l'anneau", `${auGeste}°`);

// Le carré : en haut à droite, couleur vive et pleine.
const intensite = roue.getByRole("slider", { name: "Saturation et luminosité" });
const carre = await intensite.evaluate((el) => {
  const r = el.parentElement.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await page.mouse.move(carre.x + carre.w * 0.9, carre.y + carre.h * 0.1);
await page.mouse.down();
await page.mouse.up();
check(
  Number(await intensite.getAttribute("aria-valuenow")) >= 85,
  "le carré règle la luminosité",
  await intensite.getAttribute("aria-valuetext"),
);

// Un code exact.
await roue.getByLabel("Code couleur").fill(CIBLE);
const apercu = await roue.getByTestId("apercu-encre").evaluate((el) => getComputedStyle(el).backgroundColor);
check(apercu === `rgb(${RVB.join(", ")})`, "un code tapé est pris tel quel", apercu);
await page.screenshot({ path: "shots/couleur-roue-desktop.png" });

await roue.getByRole("button", { name: "Utiliser cette couleur" }).click();
await roue.waitFor({ state: "detached" });
check((await bouton.getAttribute("aria-pressed")) === "true", "la roue se ferme, et le bouton porte la couleur choisie");

// --- La couleur peinte ------------------------------------------------------
await page.getByRole("button", { name: "Épais" }).click();
await canvas.evaluate(async (el) => {
  const r = el.getBoundingClientRect();
  const fire = (t, x, p, b) =>
    el.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 3, pointerType: "pen", isPrimary: true,
      pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * 0.15,
    }));
  fire("pointerdown", 0.15, 0.7, 1);
  for (let i = 1; i < 40; i++) {
    fire("pointermove", 0.15 + i * 0.015, 0.7 + Math.sin(i) * 0.05, 1);
    if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
  }
  fire("pointerup", 0.75, 0, 0);
});
await page.waitForTimeout(400);
const peinte = await encrePeinte(page);
check(proche(peinte, RVB), "le trait est peint dans la couleur choisie", `rgb(${peinte})`);

await page.waitForTimeout(1500);
await page.reload({ waitUntil: "networkidle" });
await canvas.waitFor();
await page.waitForTimeout(800);
const relue = await encrePeinte(page);
check(proche(relue, RVB), "et le reste après rechargement", `rgb(${relue})`);

// --- Les récentes -----------------------------------------------------------
await page.getByRole("button", { name: "Autre couleur" }).first().click();
await roue.waitFor();
check(
  (await roue.getByRole("button", { name: `Couleur ${CIBLE}` }).count()) === 1,
  "la couleur choisie revient parmi les récentes",
);
await page.keyboard.press("Escape");
await roue.waitFor({ state: "detached" });

// --- Le PDF -----------------------------------------------------------------
const reponse = await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=flat`);
check(reponse.status() === 200, "l'export répond", `HTTP ${reponse.status()}`);
// Les flux de contenu sont compressés (FlateDecode) : chercher dans les octets
// bruts ne trouvait aucune couleur, pas même le fond du papier.
const octets = Buffer.from(await reponse.body());
let texte = "";
for (const m of octets.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const brut = Buffer.from(m[1], "latin1");
  try {
    texte += inflateSync(brut).toString("latin1") + "\n";
  } catch {
    texte += m[1] + "\n";
  }
}
const couleurs = [...texte.matchAll(/(\d*\.?\d+) (\d*\.?\d+) (\d*\.?\d+) (?:rg|RG)\b/g)].map((m) =>
  [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255)),
);
check(
  couleurs.some((c) => proche(c, RVB, 3)),
  "le PDF porte la couleur choisie, pas l'encre par défaut",
  `${couleurs.length} couleur(s) : ${couleurs.slice(0, 4).map((c) => `rgb(${c})`).join(" ")}`,
);
await ctx.close();

// --- En thème sombre --------------------------------------------------------
const sombre = await contexte({ colorScheme: "dark" });
const nuit = await sombre.newPage();
await nuit.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
await nuit.locator('[data-testid="drawing-canvas"]').last().waitFor();
await nuit.waitForTimeout(800);
const deNuit = await encrePeinte(nuit);
check(proche(deNuit, RVB), "une couleur libre garde sa teinte en thème sombre", `rgb(${deNuit})`);
await sombre.close();

// --- Sur téléphone ----------------------------------------------------------
for (const theme of ["light", "dark"]) {
  const tel = await contexte({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, colorScheme: theme });
  const petit = await tel.newPage();
  await petit.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
  const barre = petit.getByRole("toolbar", { name: "Outils d'écriture" }).first();
  await barre.waitFor();
  const debord = await barre.evaluate((el) => el.scrollWidth - el.clientWidth);
  check(debord <= 1, `la barre garde sa largeur avec le bouton de la roue (${theme})`, `${debord} px de trop`);
  await petit.getByRole("button", { name: "Autre couleur" }).first().click();
  const feuille = petit.getByRole("dialog", { name: "Choisir une couleur" });
  await feuille.waitFor();
  await petit.waitForTimeout(500);
  const cadre = await feuille.boundingBox();
  check(
    cadre.x >= 0 && cadre.x + cadre.width <= 393 + 1 && cadre.y >= 0,
    `la roue tient dans l'écran du téléphone (${theme})`,
    `${Math.round(cadre.width)}×${Math.round(cadre.height)} en ${Math.round(cadre.x)},${Math.round(cadre.y)}`,
  );
  await petit.screenshot({ path: `shots/couleur-roue-iphone-${theme}.png` });
  await tel.close();
}

await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nLa couleur choisie est celle qui est peinte.");
process.exit(echecs ? 1 : 0);
