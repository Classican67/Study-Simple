/*
 * Glisser une note ou un paquet dans un dossier.
 *
 * Le geste est simulé en **Pointer Events tactiles**, pas à la souris : c'est
 * l'iPad qui compte, et c'est précisément ce que le glisser-déposer natif du
 * navigateur ne savait pas faire.
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

const DOSSIER = `Glisser ${Date.now()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

/**
 * Glisse une poignée jusqu'au centre d'une cible, au doigt.
 * Le maintien est indispensable : un appui bref n'est pas un glissement, pour
 * que la liste reste défilable.
 */
async function glisser(poignee, cible) {
  const p = await poignee.boundingBox();
  const c = await cible.boundingBox();
  await page.evaluate(
    async ({ p, c }) => {
      const el = document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2);
      const bouton = el.closest("button");
      const fire = (type, x, y, buttons) =>
        bouton.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch",
            isPrimary: true, pressure: 0.5, buttons, clientX: x, clientY: y,
          }),
        );
      const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

      fire("pointerdown", p.x + p.width / 2, p.y + p.height / 2, 1);
      // Le maintien avant que le glissement ne prenne.
      await attendre(450);
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        fire(
          "pointermove",
          p.x + p.width / 2 + (c.x + c.width / 2 - p.x - p.width / 2) * t,
          p.y + p.height / 2 + (c.y + c.height / 2 - p.y - p.height / 2) * t,
          1,
        );
        await attendre(20);
      }
      fire("pointerup", c.x + c.width / 2, c.y + c.height / 2, 0);
    },
    { p, c },
  );
  await page.waitForTimeout(1500);
}

// --- Préparer un dossier de chaque côté ---------------------------------------
//
// Les notes et les paquets ont chacun leur classement : un dossier créé dans
// les notes n'apparaît pas dans les paquets, et réciproquement.
section("préparation");
const creerDossier = async (nom) => {
  await page.getByRole("button", { name: "Dossier", exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] input[name="name"]').fill(nom);
  await page.locator('[role="dialog"] button[type="submit"]').click();
  await page.waitForTimeout(1800);
};

const DOSSIER_PAQUETS = `${DOSSIER} paquets`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await creerDossier(DOSSIER);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await creerDossier(DOSSIER_PAQUETS);

// Une note à nous, reconnaissable.
const TITRE = `À glisser ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(TITRE);
await page.locator('[aria-label^="Bloc paragraphe"]').click();
await page.waitForTimeout(1500);
check(true, "dossier et note créés");

// --- Glisser une note dans un dossier -----------------------------------------
section("note → dossier");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });

const poigneeNote = page.getByRole("button", { name: new RegExp(`Déplacer ${TITRE}`) });
check(await poigneeNote.count() === 1, "la note a une poignée");

const cibleDossier = page.locator(`[data-drop-folder]`).filter({ hasText: DOSSIER }).first();
check(await cibleDossier.count() === 1, "le dossier est une cible de dépôt");

await glisser(poigneeNote, cibleDossier);
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
check(
  (await page.locator("a", { hasText: TITRE }).count()) === 0,
  "la note a quitté la racine",
);

const lienDossier = page.locator('a[href*="folder="]').filter({ hasText: DOSSIER }).first();
const idDossier = new URL(await lienDossier.getAttribute("href"), BASE).searchParams.get("folder");
await page.goto(`${BASE}/notes?folder=${idDossier}`, { waitUntil: "networkidle" });
check(
  (await page.locator("a", { hasText: TITRE }).count()) === 1,
  "et se trouve dans le dossier",
);

// --- La ressortir en la glissant sur le fil d'Ariane --------------------------
section("note → racine");
const poigneeDansDossier = page.getByRole("button", { name: new RegExp(`Déplacer ${TITRE}`) });
const racine = page.locator('[data-drop-folder="__root__"]').first();
check(await racine.count() === 1, "le fil d'Ariane est une cible");
await glisser(poigneeDansDossier, racine);

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
check(
  (await page.locator("a", { hasText: TITRE }).count()) === 1,
  "la note est revenue à la racine",
);

// --- Glisser un paquet dans un dossier ----------------------------------------
section("paquet → dossier");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const poigneePaquet = page.getByRole("button", { name: /^Déplacer / }).first();
check(await poigneePaquet.count() === 1, "les paquets ont une poignée");
const nomPaquet = (await poigneePaquet.getAttribute("aria-label")).replace("Déplacer ", "").split(" —")[0];

const cible = page.locator(`[data-drop-folder]`).filter({ hasText: DOSSIER_PAQUETS }).first();
check(await cible.count() >= 1, "le dossier est une cible sur l'accueil");
const idDossierPaquets = await cible.getAttribute("data-drop-folder");
await glisser(poigneePaquet, cible);

await page.goto(`${BASE}/folders/${idDossierPaquets}`, { waitUntil: "networkidle" });
check(
  (await page.locator("a", { hasText: nomPaquet }).count()) >= 1,
  `« ${nomPaquet} » est dans le dossier`,
);

// --- Un appui bref ne déplace rien ---------------------------------------------
section("appui bref");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const avant = await page.locator('a[href^="/notes/"]').count();
const poignee = page.getByRole("button", { name: /^Déplacer / }).first();
const box = await poignee.boundingBox();
await page.evaluate((b) => {
  const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).closest("button");
  const fire = (type, buttons) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch",
        isPrimary: true, buttons, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2,
      }),
    );
  fire("pointerdown", 1);
  fire("pointerup", 0);
}, box);
await page.waitForTimeout(800);
check(
  (await page.locator('a[href^="/notes/"]').count()) === avant,
  "un appui bref sur la poignée ne déplace rien",
);
check(
  (await page.locator("[data-over]").count()) === 0,
  "et ne laisse aucune cible surlignée",
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
