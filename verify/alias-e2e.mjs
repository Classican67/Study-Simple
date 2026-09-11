/*
 * Regroupement de cartes en alias.
 *
 * Le scénario est celui décrit par l'usage : des figures éparpillées dans les
 * paquets d'un cours, qu'on réunit dans un paquet de révision.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token, deckId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};

const TITRE = `Figures ${Date.now()}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

// --- 0. Donner une image à deux cartes, pour qu'il y ait quelque chose à trier
await page.goto(`${BASE}/decks/${deckId}`, { waitUntil: "networkidle" });
const avecImage = await page.locator('img[alt^="Illustration"]').count();
if (avecImage < 1) {
  await page.locator('input[type="file"]:not([capture])').first().setInputFiles("photo.png");
  // Le recadreur s'ouvre : on valide tel quel.
  await page.waitForSelector('[role="application"]', { timeout: 10000 });
  await page.getByRole("button", { name: /Valider|Utiliser|Confirmer/ }).first().click();
  await page.waitForTimeout(1500);
}
const images = await page.locator('img[alt^="Illustration"]').count();
check(images >= 1, `le paquet a ${images} carte(s) avec image`);

// --- 1. Regrouper -----------------------------------------------------------
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
check(true, "la boîte de regroupement s'ouvre");

const annonce = page.locator('[aria-live="polite"]').first();
await page.waitForFunction(
  () => !document.querySelector('[aria-live="polite"]')?.textContent?.includes("Calcul"),
  { timeout: 5000 },
);
const texteImages = await annonce.innerText();
check(/\d+ carte/.test(texteImages), "il annonce combien de cartes seront reprises", texteImages);

// Sans le filtre, il doit y en avoir davantage.
await page.getByRole("switch", { name: "Seulement les cartes avec image" }).click();
await page.waitForTimeout(800);
const texteTout = await annonce.innerText();
const n = (t) => Number((t.match(/(\d+) carte/) ?? [0, 0])[1]);
check(
  n(texteTout) > n(texteImages),
  "décocher le filtre reprend davantage de cartes",
  `${texteImages} → ${texteTout}`,
);
await page.getByRole("switch", { name: "Seulement les cartes avec image" }).click();
await page.waitForTimeout(800);

// Tout sélectionner / tout décocher
await page.getByRole("button", { name: "Tout décocher" }).click();
await page.waitForTimeout(300);
check(
  (await annonce.innerText()).includes("au moins un paquet"),
  "sans paquet choisi, il le dit et n'active pas le bouton",
);
check(await page.getByRole("button", { name: "Regrouper" }).last().isDisabled(), "et le bouton est inactif");
await page.getByRole("button", { name: "Tout sélectionner" }).click();
await page.waitForTimeout(800);

await page.getByLabel("Titre du nouveau paquet").fill(TITRE);
await page.screenshot({ path: "shots/regroupement.png" });
await page.getByRole("button", { name: "Regrouper" }).last().click();
await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
check(true, "le regroupement mène au paquet créé");

const reprises = page.locator("text=/Reprise de/");
const nbReprises = await reprises.count();
check(nbReprises >= 1, `${nbReprises} carte(s) marquée(s) comme reprise`);
check(
  (await page.locator('img[alt^="Illustration"]').count()) === nbReprises,
  "toutes portent bien une image",
);
const paquetRegroupe = page.url();

// --- 2. Une reprise n'est pas modifiable sur place --------------------------
check(
  (await page.locator('[aria-label^="Terme de la carte"]').count()) === 0,
  "aucune reprise n'offre de champ modifiable",
);
await page.screenshot({ path: "shots/paquet-reprises.png" });

// --- 3. Relancer ne crée pas de doublon -------------------------------------
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
await page.selectOption('select[aria-label="Paquet de destination"]', { label: TITRE });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Regrouper" }).last().click();
await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
check(
  (await page.locator("text=/Reprise de/").count()) === nbReprises,
  "relancer le regroupement ne crée pas de doublon",
  String(await page.locator("text=/Reprise de/").count()),
);

// --- 4. Corriger l'originale corrige la reprise -----------------------------
const lien = page.locator('a[href*="#card-"]').first();
const cible = await lien.getAttribute("href");
const destination = cible.split("#")[0];
await lien.click();
// Attendre la DESTINATION, et non « une page de paquet » : on est déjà sur
// une page de paquet, la condition serait vraie avant même la navigation.
await page.waitForURL((u) => u.pathname === destination, { timeout: 10000 });
check(page.url().includes(destination), "le lien mène au paquet d'origine", page.url());

const champ = page.locator('[aria-label^="Terme de la carte"]').first();
const ancien = (await champ.innerText()).trim();
await champ.click();
await page.keyboard.press("End");
await champ.pressSequentially(" CORRIGÉ");
await page.locator("h1").click();
await page.waitForTimeout(1500);

await page.goto(paquetRegroupe, { waitUntil: "networkidle" });
const contenu = await page.locator("main").innerText();
check(
  contenu.includes(`${ancien} CORRIGÉ`),
  "la correction faite sur l'originale apparaît dans la reprise",
  contenu.slice(0, 120).replace(/\n/g, " "),
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
