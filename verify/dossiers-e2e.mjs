/*
 * Deux classements séparés, et une recherche qui sait où chercher.
 *
 * Les dossiers des paquets et ceux des notes partageaient un seul arbre : créer
 * un dossier pour ranger ses notes en faisait apparaître un dans les paquets.
 * Ce sont deux classements différents.
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

const marque = Date.now();
const DOSSIER_NOTES = `Thème ${marque}`;
const DOSSIER_PAQUETS = `Cours ${marque}`;
const MOT = `zygomatique${marque}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 } });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 150)); ko++; });

/** Crée un dossier depuis la page courante et attend qu'il apparaisse. */
async function creerDossier(nom) {
  await page.getByRole("button", { name: "Dossier", exact: true }).click();
  await page.getByLabel(/Nom/).fill(nom);
  await page.getByRole("button", { name: /Créer|Enregistrer/ }).click();
  await page.waitForTimeout(1500);
}

const nomsVisibles = () =>
  page.locator("main").evaluate((el) => el.innerText);

// --- Un dossier de notes reste chez les notes --------------------------------
section("dossier créé depuis les Notes");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await creerDossier(DOSSIER_NOTES);
check((await nomsVisibles()).includes(DOSSIER_NOTES), "il apparaît dans les Notes");

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
check(
  !(await nomsVisibles()).includes(DOSSIER_NOTES),
  "et n'apparaît PAS dans les Paquets",
  "le dossier de notes a fui dans les paquets",
);

// --- Un dossier de paquets reste chez les paquets ----------------------------
section("dossier créé depuis les Paquets");
await creerDossier(DOSSIER_PAQUETS);
check((await nomsVisibles()).includes(DOSSIER_PAQUETS), "il apparaît dans les Paquets");

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
check(
  !(await nomsVisibles()).includes(DOSSIER_PAQUETS),
  "et n'apparaît PAS dans les Notes",
  "le dossier de paquets a fui dans les notes",
);

// --- La recherche sait où chercher -------------------------------------------
section("préparation de la recherche");
// Une note qui porte le mot.
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Note ${MOT}`);
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(1500);

// Un paquet et une carte qui portent le même mot.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Nouveau paquet|^Paquet$/ }).first().click();
await page.locator("#deck-title").fill(`Paquet ${MOT}`);
await page.getByRole("button", { name: "Créer le paquet" }).click();
await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
await page.getByRole("button", { name: "Ajouter une carte" }).click();
await page.waitForTimeout(800);
// Les deux faces sont des éditeurs riches : on y tape, on ne les remplit pas.
await page.locator('[aria-label="Terme de la carte 1"]').click();
await page.keyboard.type(`Carte ${MOT}`);
await page.locator('[aria-label="Définition de la carte 1"]').click();
await page.keyboard.type("os de la pommette");
await page.locator("h1").first().click();
await page.waitForTimeout(2500);

section("portée de la recherche");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByTitle("Rechercher (Ctrl+K)").click();
// La page des notes a son propre champ : on vise celui du dialogue.
const dialogue = page.getByRole("dialog", { name: "Rechercher" });
const champ = dialogue.getByRole("searchbox");
const groupe = dialogue.getByRole("group", { name: "Chercher dans" });
await groupe.waitFor();
check(await groupe.isVisible(), "on peut choisir où l'on cherche");

// Dans les paquets : la carte, pas la note.
await groupe.getByRole("button", { name: "Paquets" }).click();
await champ.fill(MOT);
await page.waitForTimeout(2500);
const cartes = await dialogue.getByRole("listbox", { name: "Résultats" }).innerText().catch(() => "");
check(cartes.includes(`Carte ${MOT}`), "« Paquets » trouve la carte", cartes.slice(0, 120));
check(!cartes.includes(`Note ${MOT}`), "et ne remonte pas la note", cartes.slice(0, 120));

// Dans les notes : la note, pas la carte.
await groupe.getByRole("button", { name: "Notes" }).click();
await page.waitForTimeout(2500);
const notes = await dialogue.getByRole("listbox", { name: "Résultats" }).innerText().catch(() => "");
check(notes.includes(`Note ${MOT}`), "« Notes » trouve la note", notes.slice(0, 120));
check(!notes.includes(`Carte ${MOT}`), "et ne remonte pas la carte", notes.slice(0, 120));

// Le choix mène où il faut.
await dialogue.getByRole("option").first().click();
await page.waitForTimeout(2000);
check(/\/notes\/[a-z0-9]+/.test(page.url()), "et ouvrir un résultat mène à la note", page.url());

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
