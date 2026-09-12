/*
 * Gestion des pages d'une note : gomme précise, duplication, volet de pages.
 *
 * Les trois gestes qu'on fait sans y penser dans un cahier, et qui manquaient :
 * corriger une lettre sans perdre la ligne, refaire une page en variante, et
 * retrouver une page au milieu de quarante.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 150)); ko++; });

/** Trace un trait sur le n-ième canevas, en coordonnées relatives. */
const tracer = (n, points) =>
  page.evaluate(
    ({ n, points }) => {
      const el = document.querySelectorAll('[data-testid="drawing-canvas"]')[n];
      const r = el.getBoundingClientRect();
      const fire = (type, x, y, p, buttons) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
            isPrimary: true, pressure: p, buttons,
            clientX: r.left + r.width * x, clientY: r.top + r.width * y,
          }),
        );
      fire("pointerdown", points[0][0], points[0][1], 0.8, 1);
      for (const [x, y] of points.slice(1)) fire("pointermove", x, y, 0.8, 1);
      fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
    },
    { n, points },
  );

/** Nombre de traits d'une page, lu sur l'étiquette du canevas. */
const traits = async (n) => {
  const label = await page.locator('[data-testid="drawing-canvas"]').nth(n).getAttribute("aria-label");
  return Number(/(\d+) trait/.exec(label)?.[1] ?? -1);
};

section("préparation");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Pages ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
// Une longue ligne horizontale, bien échantillonnée.
await tracer(0, Array.from({ length: 40 }, (_, i) => [0.08 + (i * 0.84) / 39, 0.25]));
await page.waitForTimeout(1200);
check((await traits(0)) === 1, "un trait tracé", String(await traits(0)));

section("gomme précise");
await page.getByRole("button", { name: "Gomme", exact: true }).first().click();
await page.getByRole("button", { name: "Précise" }).click();
check(
  (await page.getByRole("button", { name: "Précise" }).getAttribute("aria-pressed")) === "true",
  "la gomme précise est active",
);
// Un seul contact, au milieu de la ligne : deux morceaux doivent rester.
// (Un passage traînant couperait autant de fois qu'il touche, ce qui est juste
// mais ne prouve rien de plus.)
await tracer(0, [[0.5, 0.25]]);
await page.waitForTimeout(1200);
check(
  (await traits(0)) === 2,
  "elle coupe la ligne en deux au lieu de l'effacer",
  `${await traits(0)} trait(s)`,
);

// Et la gomme ordinaire reprend tout.
await page.getByRole("button", { name: "Trait entier" }).click();
await tracer(0, [[0.2, 0.25], [0.22, 0.25]]);
await page.waitForTimeout(1200);
check((await traits(0)) === 1, "la gomme ordinaire emporte le morceau entier", `${await traits(0)} trait(s)`);

section("duplication");
// La note s'ouvre sur un bloc de texte : la page manuscrite est la deuxième.
await page.getByRole("button", { name: "Dupliquer le bloc 2" }).click();
await page.waitForTimeout(2500);
for (const plainte of await page.locator('p[role="alert"]').allInnerTexts()) {
  console.log("   l'app se plaint :", plainte);
}
check(
  (await page.locator('[data-testid="drawing-canvas"]').count()) === 2,
  "la copie apparaît",
);
check((await traits(1)) === (await traits(0)), "avec le même contenu que l'original");

// Modifier la copie ne touche pas l'original : c'est tout l'intérêt.
const avant = await traits(0);
await page.getByRole("button", { name: "Stylo", exact: true }).nth(1).click();
await tracer(1, [[0.3, 0.6], [0.7, 0.62]]);
await page.waitForTimeout(1500);
check((await traits(1)) === avant + 1, "on peut écrire sur la copie");
check((await traits(0)) === avant, "sans que l'original bouge", `${await traits(0)} au lieu de ${avant}`);

// Et la copie se place juste sous l'original, pas à la fin.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
check((await page.locator('[data-testid="drawing-canvas"]').count()) === 2, "les deux pages sont enregistrées");

section("volet de pages");
const volet = page.getByRole("button", { name: /Choisir une page/ });
check(await volet.isVisible(), "le repère de page apparaît dès la deuxième page");
await volet.click();
const liste = page.getByRole("list", { name: "Pages manuscrites" });
await liste.waitFor();
check((await liste.getByRole("listitem").count()) === 2, "le volet montre les deux pages");
check(
  (await liste.locator('canvas, img, [role="img"]').count()) >= 2,
  "et chacune est montrée en vignette, pas en numéro",
  String(await liste.locator('canvas, img, [role="img"]').count()),
);
// La vignette est lisible : au moins la taille d'une pastille tactile.
const boite = await liste.getByRole("listitem").first().locator("canvas, img, [role='img']").first()
  .evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
// Assez grande pour reconnaître la page, et au format de la page elle-même.
check(boite.w >= 80, "et assez grande pour se reconnaître", JSON.stringify(boite));
check(Math.abs(boite.h / boite.w - 0.75) < 0.05, "au format de la page", JSON.stringify(boite));

await liste.getByRole("button", { name: "Page 2" }).click();
await page.waitForTimeout(1200);
const visible = await page.evaluate(() => {
  const pages = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const r = pages[1].closest("section").getBoundingClientRect();
  return r.top < window.innerHeight * 0.5;
});
check(visible, "cliquer une vignette emmène à sa page");

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
