/*
 * Sûreté des copies.
 *
 * Le regroupement duplique les cartes. Une copie doit être entièrement
 * indépendante : on la modifie, on la supprime, on supprime son paquet entier,
 * sans jamais toucher à l'originale — ni à son contenu, ni à son image.
 *
 * Le seul lien qui subsiste entre les deux est invisible et dangereux : elles
 * partagent le NOM DE FICHIER de leur image. La moitié des vérifications ci-
 * dessous ne porte que là-dessus.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const { token, deckId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const UPLOADS = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (titre) => console.log(`\n── ${titre} ──`);

const TITRE = `Figures ${Date.now()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

const champ = (n) => page.locator(`[aria-label="Terme de la carte ${n}"]`);
const definition = (n) => page.locator(`[aria-label="Définition de la carte ${n}"]`);

async function ecrire(locator, texte) {
  await locator.click();
  await page.keyboard.press("End");
  await locator.pressSequentially(texte);
  await page.locator("h1").click();
  await page.waitForTimeout(1200);
}

/** État d'une carte vu depuis la base, via la page de son paquet. */
async function lire(url, n) {
  await page.goto(url, { waitUntil: "networkidle" });
  return {
    terme: (await champ(n).innerText()).trim(),
    definition: (await definition(n).innerText()).trim(),
    image: await page.locator('img[alt^="Illustration"]').first().getAttribute("src").catch(() => null),
    cartes: await page.locator('[aria-label^="Terme de la carte"]').count(),
  };
}

// --- Préparer une carte avec image dans le paquet source --------------------
section("préparation");
const urlSource = `${BASE}/decks/${deckId}`;
await page.goto(urlSource, { waitUntil: "networkidle" });
if ((await page.locator('img[alt^="Illustration"]').count()) === 0) {
  await page.locator('input[type="file"]:not([capture])').first().setInputFiles("photo.png");
  await page.waitForSelector('[role="application"]', { timeout: 10000 });
  await page.getByRole("button", { name: /Valider|Utiliser|Confirmer/ }).first().click();
  await page.waitForTimeout(2000);
}
const srcImage = await page.locator('img[alt^="Illustration"]').first().getAttribute("src");
const fichier = srcImage.split("/").pop();
check(existsSync(path.join(UPLOADS, fichier)), "une carte source porte une image sur le disque", fichier);

const avantSource = await lire(urlSource, 1);
check(avantSource.cartes > 0, `le paquet source a ${avantSource.cartes} cartes`);

// --- Copier ------------------------------------------------------------------
section("copie");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(1000);
await page.getByLabel("Titre du nouveau paquet").fill(TITRE);
await page.getByRole("button", { name: "Regrouper" }).last().click();
await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
const urlCopies = page.url();

check(
  (await page.locator("text=/Copiée de/").count()) >= 1,
  "les cartes copiées indiquent leur provenance",
);
check(
  (await page.locator('[aria-label^="Terme de la carte"]').count()) >= 1,
  "et restent modifiables — ce sont de vraies copies",
);

// --- 1. Modifier la copie ne touche pas l'originale -------------------------
section("modifier la copie");
await ecrire(champ(1), " COPIE-MODIFIÉE");
const apres1Copie = await lire(urlCopies, 1);
const apres1Source = await lire(urlSource, 1);
check(apres1Copie.terme.includes("COPIE-MODIFIÉE"), "la copie a bien changé");
check(
  apres1Source.terme === avantSource.terme,
  "l'originale est inchangée",
  `${avantSource.terme} → ${apres1Source.terme}`,
);

// --- 2. Modifier l'originale ne touche pas la copie -------------------------
section("modifier l'originale");
await ecrire(champ(1), " SOURCE-MODIFIÉE");
const apres2Source = await lire(urlSource, 1);
const apres2Copie = await lire(urlCopies, 1);
check(apres2Source.terme.includes("SOURCE-MODIFIÉE"), "l'originale a bien changé");
check(
  !apres2Copie.terme.includes("SOURCE-MODIFIÉE"),
  "la copie est inchangée : l'indépendance joue dans les deux sens",
  apres2Copie.terme,
);

// --- 3. Supprimer une copie ne touche ni l'originale ni son image -----------
section("supprimer une copie");
await page.goto(urlCopies, { waitUntil: "networkidle" });
const avantSuppression = await page.locator('[aria-label^="Terme de la carte"]').count();
await page.getByRole("button", { name: "Supprimer la carte 1" }).click();
await page.waitForSelector('[role="dialog"]');
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForTimeout(1500);
check(
  (await page.locator('[aria-label^="Terme de la carte"]').count()) === avantSuppression - 1,
  "la copie est supprimée",
);
check(existsSync(path.join(UPLOADS, fichier)), "le fichier image est toujours sur le disque");
const apres3Source = await lire(urlSource, 1);
check(apres3Source.cartes === avantSource.cartes, "le paquet source a toujours toutes ses cartes");
check(
  (await page.request.get(`${BASE}/api/uploads/${fichier}`)).status() === 200,
  "et l'image de l'originale se charge encore",
);

// --- 4. Remplacer l'image de l'originale n'efface pas celle de la copie -----
section("remplacer une image");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
await page.selectOption('select[aria-label="Paquet de destination"]', { label: TITRE });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Regrouper" }).last().click();
await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
check(true, "les cartes sont de nouveau copiées");

await page.goto(urlSource, { waitUntil: "networkidle" });
await page.locator('button[aria-label="Retirer l\'image"]').first().click();
await page.waitForTimeout(1500);
check(
  (await page.request.get(`${BASE}/api/uploads/${fichier}`)).status() === 200,
  "retirer l'image de l'originale laisse celle de la copie intacte",
);
await page.goto(urlCopies, { waitUntil: "networkidle" });
check(
  (await page.locator('img[alt^="Illustration"]').count()) >= 1,
  "la copie affiche toujours son image",
);

// --- 5. Supprimer tout le paquet de copies ----------------------------------
section("supprimer le paquet de copies");
const cartesSourceAvant = (await lire(urlSource, 1)).cartes;
await page.goto(urlCopies, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Supprimer le paquet", exact: true }).click();
await page.waitForSelector('[role="dialog"]');
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForURL(`${BASE}/`, { timeout: 15000 });
check(true, "le paquet de copies est supprimé");
const apres5Source = await lire(urlSource, 1);
check(
  apres5Source.cartes === cartesSourceAvant,
  "le paquet source garde toutes ses cartes",
  `${cartesSourceAvant} → ${apres5Source.cartes}`,
);
check(
  apres5Source.terme === apres2Source.terme,
  "et leur contenu est intact",
  `${apres2Source.terme} → ${apres5Source.terme}`,
);

// --- 6. Le ménage des fichiers fonctionne encore ----------------------------
section("ménage des fichiers");
check(
  (await page.request.get(`${BASE}/api/uploads/${fichier}`)).status() === 404,
  "l'image que plus aucune carte ne référence a bien été effacée",
  `HTTP ${(await page.request.get(`${BASE}/api/uploads/${fichier}`)).status()}`,
);

// --- 7. Un regroupement qui ne trouve rien ne laisse pas de paquet fantôme --
section("échec sans dégât");
const avantPaquets = await (async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  return page.locator('a[href^="/decks/"]').count();
})();

await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(1000);
// Plus aucune carte ne porte d'image : le filtre ne doit rien trouver.
await page.getByLabel("Titre du nouveau paquet").fill(`Fantôme ${Date.now()}`);
const annonce = await page.locator('[aria-live="polite"]').first().innerText();
const bouton = page.getByRole("button", { name: "Regrouper" }).last();

if (annonce.includes("Aucune carte")) {
  check(await bouton.isDisabled(), "sans carte correspondante, le bouton est inactif");
} else {
  await bouton.click();
  await page.waitForTimeout(2000);
}
await page.keyboard.press("Escape");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
check(
  (await page.locator('a[href^="/decks/"]').count()) === avantPaquets,
  "aucun paquet vide n'est laissé derrière",
  `${avantPaquets} → ${await page.locator('a[href^="/decks/"]').count()}`,
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
