/*
 * Sélection des paquets à regrouper.
 *
 * Le point : ne pas tout prendre par défaut, et savoir avant de cocher quels
 * paquets contiennent réellement des figures.
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

// Une image sur une carte, pour que les comptes ne soient pas tous nuls.
await page.goto(`${BASE}/decks/${deckId}`, { waitUntil: "networkidle" });
if ((await page.locator('img[alt^="Illustration"]').count()) === 0) {
  await page.locator('input[type="file"]:not([capture])').first().setInputFiles("photo.png");
  await page.waitForSelector('[role="application"]', { timeout: 10000 });
  await page.getByRole("button", { name: /Valider|Utiliser|Confirmer/ }).first().click();
  await page.waitForTimeout(2000);
}

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Regrouper" }).click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(1200);

const cases = page.locator('[role="dialog"] input[type="checkbox"]');
// Une case n'a pas de descendant : `cases.locator(":checked")` ne trouverait
// jamais rien et l'assertion passerait à vide.
const cochees = () => page.locator('[role="dialog"] input[type="checkbox"]:checked').count();
const annonce = page.locator('[role="dialog"] [aria-live="polite"]').first();
const valider = page.getByRole("button", { name: "Regrouper" }).last();
const nbPaquets = await cases.count();
check(nbPaquets >= 2, `${nbPaquets} paquets proposés`);

// --- 1. Rien de coché au départ ---------------------------------------------
check((await cochees()) === 0, "aucun paquet coché d'avance");
check(await valider.isDisabled(), "le bouton est inactif tant que rien n'est choisi");
check(
  (await annonce.innerText()).includes("Choisis les paquets"),
  "et l'app le dit",
  await annonce.innerText(),
);

// --- 2. Chaque paquet annonce ce qu'il donnerait -----------------------------
const lignes = await page.locator('[role="dialog"] li label').evaluateAll((els) =>
  els.map((el) => el.innerText.replace(/\n/g, " ").trim()),
);
check(
  lignes.every((l) => /\d+\s*\/\s*\d+/.test(l)),
  "chaque paquet affiche « avec image / total »",
  JSON.stringify(lignes),
);

// --- 3. Cocher un seul paquet -----------------------------------------------
await cases.nth(0).check();
await page.waitForTimeout(400);
const unSeul = await annonce.innerText();
check(/\d+ carte/.test(unSeul) || unSeul.includes("Aucune"), "le compte suit la sélection", unSeul);

const premier = Number((lignes[0].match(/(\d+)\s*\/\s*\d+/) ?? [0, 0])[1]);
if (premier > 0) {
  check(
    unSeul.includes(`${premier} carte`),
    "et vaut exactement ce que ce paquet annonce",
    `${premier} attendu, annoncé : ${unSeul}`,
  );
}

// --- 4. Cocher un second additionne ------------------------------------------
await cases.nth(1).check();
await page.waitForTimeout(400);
const deux = await annonce.innerText();
const n = (t) => Number((t.match(/(\d+) carte/) ?? [0, 0])[1]);
const second = Number((lignes[1].match(/(\d+)\s*\/\s*\d+/) ?? [0, 0])[1]);
check(
  n(deux) === premier + second,
  "deux paquets cochés donnent la somme des deux",
  `${premier} + ${second} ≠ ${n(deux)} (« ${deux} »)`,
);

// --- 5. Décocher revient en arrière ------------------------------------------
await cases.nth(1).uncheck();
await page.waitForTimeout(400);
check(n(await annonce.innerText()) === premier, "décocher retire bien sa part");

// --- 6. « Tout sélectionner » ignore les paquets sans rien à donner ---------
await page.getByRole("button", { name: "Tout sélectionner" }).click();
await page.waitForTimeout(400);
const nbCochees = await cochees();
const utiles = lignes.filter((l) => Number((l.match(/(\d+)\s*\/\s*\d+/) ?? [0, 0])[1]) > 0).length;
check(
  nbCochees === utiles,
  "« Tout sélectionner » ne coche que les paquets qui ont des figures",
  `${nbCochees} cochés pour ${utiles} utiles sur ${nbPaquets}`,
);
check(
  (await page.getByRole("button", { name: "Tout décocher" }).count()) === 1,
  "le bouton propose alors de tout décocher",
);

// --- 7. Le filtre change les comptes -----------------------------------------
await page.getByRole("switch", { name: "Seulement les cartes avec image" }).click();
await page.waitForTimeout(800);
const sansFiltre = await annonce.innerText();
check(n(sansFiltre) > n(deux), "sans filtre, davantage de cartes", `${deux} → ${sansFiltre}`);
const lignesSansFiltre = await page.locator('[role="dialog"] li label').evaluateAll((els) =>
  els.map((el) => el.innerText.replace(/\n/g, " ").trim()),
);
check(
  lignesSansFiltre.every((l) => !/\d+\s*\/\s*\d+/.test(l)),
  "et chaque paquet affiche son total simple",
  JSON.stringify(lignesSansFiltre),
);

await page.screenshot({ path: "shots/selection.png" });
console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
