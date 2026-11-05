/*
 * Audit d'accessibilité et de cohérence visuelle.
 *
 * Trois sondes :
 *  - contraste WCAG AA (4.5:1, ou 3:1 pour le grand texte) ;
 *  - cibles tactiles d'au moins 44 px ;
 *  - cohérence des positions : une classe `absolute` doit produire un
 *    `position: absolute`. Une règle maison déclarée après les utilitaires de
 *    Tailwind l'écrasait sans que rien ne le montre.
 *
 * L'audit ne voit que les états qu'il visite : un élément qui n'apparaît que
 * sous condition a besoin de son propre scénario.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token, deckId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const problems = [];

import { CONTRAST, POSITION, TOUCH } from "./sondes.mjs";

const browser = await chromium.launch();

async function audit(label, vp, path, dark, act) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (act) await act(page).catch((e) => problems.push(`  [scénario]  ${label} : ${String(e).slice(0, 80)}`));
  await page.waitForTimeout(300);

  for (const c of await page.evaluate(CONTRAST)) {
    problems.push(`  [contraste] ${label} : « ${c.text} » ${c.ratio}:1 (min ${c.need})`);
  }
  for (const t of await page.evaluate(TOUCH)) {
    problems.push(`  [tactile]   ${label} : « ${t.label} » ${t.size}`);
  }
  for (const p of await page.evaluate(POSITION)) {
    problems.push(`  [position]  ${label} : « ${p.label} » demande ${p.voulu}, obtient ${p.reel}`);
  }
  await ctx.close();
}

const phone = { width: 393, height: 852 };
const desktop = { width: 1280, height: 800 };

await audit("accueil clair", phone, "/", false);
await audit("accueil sombre", phone, "/", true);
await audit("accueil desktop", desktop, "/", false);
await audit("paquet clair", phone, `/decks/${deckId}`, false);
await audit("paquet sombre", phone, `/decks/${deckId}`, true);
await audit("révision clair", phone, `/decks/${deckId}/study?all=1`, false);
await audit("révision sombre", phone, `/decks/${deckId}/study?all=1`, true);
await audit("mode écrire", phone, `/decks/${deckId}/study?all=1&mode=write`, false);
await audit("connexion", phone, "/login", false);

// Les réglages de révision n'existent que dépliés.
const openStudyOptions = async (p) => {
  await p.getByRole("button", { name: "Options de révision" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(400);
};
await audit("options révision clair", phone, `/decks/${deckId}/study?all=1`, false, openStudyOptions);
await audit("options révision sombre", phone, `/decks/${deckId}/study?all=1`, true, openStudyOptions);

// Le sens inverse rend la question par un tout autre composant.
const reverseSide = async (p) => {
  await p.getByRole("button", { name: "Options de révision" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.getByRole("button", { name: "Définition", exact: true }).click();
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
};
await audit("sens inverse clair", phone, `/decks/${deckId}/study?all=1`, false, reverseSide);
await audit("sens inverse sombre", phone, `/decks/${deckId}/study?all=1`, true, reverseSide);

// La recherche AVEC du texte saisi : la croix d'effacement n'existe qu'alors.
const openSearch = async (p) => {
  await p.locator('button[aria-label^="Rechercher"]:visible').first().click();
  await p.waitForSelector('input[aria-label="Rechercher"]');
  await p.locator('input[aria-label="Rechercher"]').fill("mit");
  await p.waitForTimeout(700);
};
await audit("recherche clair", phone, `/decks/${deckId}`, false, openSearch);
await audit("recherche sombre", phone, `/decks/${deckId}`, true, openSearch);
await audit("recherche globale", desktop, "/", false, openSearch);

// L'export : trois liens de téléchargement dans une feuille.
const openExport = async (p) => {
  await p.getByRole("button", { name: "Exporter" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(300);
};
await audit("export clair", phone, "/", false, openExport);
await audit("export sombre", phone, "/", true, openExport);

// Le regroupement en alias : cases, interrupteur, liste défilante, annonce.
const openGroup = async (p) => {
  await p.getByRole("button", { name: "Regrouper" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(800);
};
await audit("regroupement clair", phone, "/", false, openGroup);
await audit("regroupement sombre", phone, "/", true, openGroup);
await audit("regroupement desktop", desktop, "/", false, openGroup);

// La sauvegarde, telle que la voit un serveur sans Google configuré. Reliée, à
// relier, en cours : ces états-là se mesurent dans `drive-e2e.mjs`.
await audit("sauvegarde clair", phone, "/sauvegarde", false);
await audit("sauvegarde sombre desktop", desktop, "/sauvegarde", true);

// Les notes : la liste, puis un éditeur portant les trois types de blocs.
await audit("notes liste clair", phone, "/notes", false);
await audit("notes liste sombre", phone, "/notes", true);

// Autonome : s'il n'y a pas de note, on en crée une, et on s'assure que les
// trois types de blocs sont présents — c'est tout l'objet du scénario.
const openNote = async (p) => {
  if ((await p.locator('a[href^="/notes/"]').count()) === 0) {
    await p.getByRole("button", { name: "Nouvelle note" }).click();
    await p.waitForURL(/\/notes\/[a-z0-9]+/);
  } else {
    await p.locator('a[href^="/notes/"]').first().click();
  }
  await p.waitForSelector("section[aria-label^='Bloc']");

  if ((await p.locator("table").count()) === 0) {
    await p.getByRole("button", { name: "Tableau", exact: true }).last().click();
    await p.waitForSelector("table");
  }
  if ((await p.locator('[data-testid="drawing-canvas"]').count()) === 0) {
    await p.getByRole("button", { name: "Croquis", exact: true }).last().click();
    await p.waitForSelector('[data-testid="drawing-canvas"]');
  }
  await p.waitForTimeout(500);
};
await audit("note éditeur clair", phone, "/notes", false, openNote);
await audit("note éditeur sombre", phone, "/notes", true, openNote);
await audit("note éditeur desktop", desktop, "/notes", false, openNote);

// La roue chromatique n'existe qu'ouverte : sans son propre passage, l'audit ne
// la verrait jamais.
const openWheel = async (p) => {
  await openNote(p);
  await p.getByRole("button", { name: "Autre couleur" }).first().click();
  await p.getByRole("dialog", { name: "Choisir une couleur" }).waitFor();
  await p.waitForTimeout(400);
};
await audit("roue chromatique clair", phone, "/notes", false, openWheel);
await audit("roue chromatique sombre", phone, "/notes", true, openWheel);
await audit("roue chromatique desktop", desktop, "/notes", false, openWheel);

// Les menus contextuels n'existent qu'ouverts, et la pastille « maîtrisée »
// seulement sur une note marquée : chacun a donc son passage.
const openNoteMenu = async (p) => {
  await p.locator('button[aria-label^="Options de la note"]').first().click();
  await p.getByRole("menu").waitFor();
  await p.waitForTimeout(300);
};
await audit("menu note clair", phone, "/notes", false, openNoteMenu);
await audit("menu note sombre", phone, "/notes", true, openNoteMenu);
await audit("menu note desktop", desktop, "/notes", false, openNoteMenu);

const openFolderMenu = async (p) => {
  await p.locator('button[aria-label^="Options du dossier"]').first().click();
  await p.getByRole("menu").waitFor();
  await p.waitForTimeout(300);
};
await audit("menu dossier clair", phone, "/notes", false, openFolderMenu);
await audit("menu dossier sombre desktop", desktop, "/notes", true, openFolderMenu);

const markMastered = async (p) => {
  await openNoteMenu(p);
  const marquer = p.getByRole("menuitem", { name: "Marquer comme maîtrisée" });
  if (await marquer.count()) await marquer.click();
  else await p.keyboard.press("Escape");
  await p.waitForTimeout(900);
};
await audit("pastille maîtrisée clair", phone, "/notes?vue=list", false, markMastered);
await audit("pastille maîtrisée sombre", desktop, "/notes", true, async (p) => p.waitForTimeout(300));

await browser.close();
console.log(problems.length ? problems.join("\n") : "Aucun problème de contraste, de cible tactile ni de position.");
process.exit(problems.length ? 1 : 0);
