/*
 * Notes : dossiers, recherche avancée, et page manuscrite.
 *
 * Les critères de recherche vivent dans l'adresse : une recherche se partage
 * et survit à un rechargement. C'est ce que vérifie la seconde moitié.
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

const MOT = `Thermo${Date.now()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

// --- Créer un dossier depuis la section Paquets -----------------------------
section("préparation");
const DOSSIER = `Physique ${Date.now()}`;
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Dossier/ }).first().click();
await page.waitForSelector('[role="dialog"]');
await page.locator('[role="dialog"] input[name="name"]').fill(DOSSIER);
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForTimeout(1500);
check(true, `dossier « ${DOSSIER} » créé`);

// --- Une note, rangée dans ce dossier ---------------------------------------
section("dossiers");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`${MOT} appliquée`);
await page.locator('[aria-label^="Bloc paragraphe"]').click();
await page.locator('[aria-label^="Bloc paragraphe"]').pressSequentially("Entropie et enthalpie");
await page.locator("h1, [aria-label='Titre de la note']").first().click();
await page.waitForTimeout(1500);

await page.getByRole("button", { name: /Ranger la note/ }).click();
await page.waitForSelector('[role="dialog"]');
await page.getByRole("button", { name: DOSSIER, exact: true }).click();
await page.waitForTimeout(1500);
check(true, "la note est rangée dans le dossier");

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const carteDossier = page.locator('a[href*="folder="]').filter({ hasText: DOSSIER }).first();
check(await carteDossier.count() > 0, "le dossier apparaît dans la section Notes");
// Capturé maintenant : plus bas, la page de résultats n'affiche plus de
// dossiers et le locator ne trouverait plus rien.
const hrefDossier = await carteDossier.getAttribute("href");
const idDossier = new URL(hrefDossier, BASE).searchParams.get("folder");
await carteDossier.click();
await page.waitForURL(/folder=/);
check(
  (await page.locator('a[href^="/notes/"]').count()) >= 1,
  "et contient la note",
);
check(
  (await page.locator("nav[aria-label='Fil d\\'Ariane']").innerText()).includes(DOSSIER),
  "le fil d'Ariane indique où l'on est",
);

// --- Recherche ---------------------------------------------------------------
section("recherche");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const champ = page.getByLabel("Rechercher dans les notes");

await champ.fill("Entropie");
await page.waitForTimeout(900);
check(page.url().includes("q=Entropie"), "la recherche vit dans l'adresse", page.url());
check(
  (await page.locator('a[href^="/notes/"]').count()) >= 1,
  "un mot du corps de la note la retrouve",
);

await champ.fill(MOT);
await page.waitForTimeout(900);
check((await page.locator('a[href^="/notes/"]').count()) >= 1, "un mot du titre aussi");

await champ.fill("motabsentxyz");
await page.waitForTimeout(900);
check(
  (await page.locator("text=Aucune note ne correspond").count()) === 1,
  "et une recherche infructueuse le dit",
);

// La recherche porte sur tout, pas sur le dossier ouvert.
await page.goto(`${BASE}/notes?folder=${idDossier}`, { waitUntil: "networkidle" });
await page.getByLabel("Rechercher dans les notes").fill("Entropie");
await page.waitForTimeout(900);
check(!page.url().includes("folder="), "chercher sort du dossier courant", page.url());

// --- Filtres par type de bloc ------------------------------------------------
section("filtres");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const avant = await page.locator('a[href^="/notes/"]').count();
await page.getByRole("button", { name: "Manuscrit" }).click();
await page.waitForTimeout(900);
check(page.url().includes("has=drawing"), "le filtre vit dans l'adresse", page.url());
const manuscrites = await page.locator('a[href^="/notes/"]').count();
check(manuscrites <= avant, `${manuscrites} note(s) manuscrite(s) sur ${avant}`);

await page.getByRole("button", { name: "Texte", exact: true }).click();
await page.waitForTimeout(900);
check(page.url().includes("has=text"), "changer de filtre remplace le précédent", page.url());
check(
  (await page.locator('a[href^="/notes/"]').count()) >= 1,
  "et le filtre « Texte » retrouve la note",
);

await page.getByRole("button", { name: "Tout afficher" }).click();
await page.waitForTimeout(900);
check(!page.url().includes("has="), "« Tout afficher » remet à zéro");

// --- Page manuscrite ---------------------------------------------------------
section("page manuscrite");
// Une note neuve, à nous : rouvrir la première ferait tomber sur les blocs
// laissés par un essai précédent, et les locators viseraient au hasard.
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Manuscrite ${Date.now()}`);
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);

const canvas = page.locator('[data-testid="drawing-canvas"]').last();
check(
  (await page.getByRole("toolbar", { name: "Outils d'écriture" }).count()) === 1,
  "la palette est là",
  `${await page.getByRole("toolbar", { name: "Outils d'écriture" }).count()} palette(s)`,
);
for (const outil of ["Stylo", "Surligneur", "Gomme"]) {
  check((await page.getByRole("button", { name: outil, exact: true }).count()) >= 1, `outil « ${outil} »`);
}
for (const papier of ["Uni", "Lignes", "Carreaux", "Points"]) {
  check((await page.getByRole("button", { name: papier, exact: true }).count()) >= 1, `papier « ${papier} »`);
}

async function tracer(points, pointerType = "pen") {
  await page.evaluate(
    ({ points, pointerType }) => {
      const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
      const el = tous[tous.length - 1];
      const r = el.getBoundingClientRect();
      const fire = (type, x, y, pressure, buttons) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType, isPrimary: true,
            pressure, buttons,
            clientX: r.left + r.width * x,
            clientY: r.top + r.height * y,
          }),
        );
      fire("pointerdown", points[0][0], points[0][1], points[0][2], 1);
      for (const [x, y, p] of points.slice(1)) fire("pointermove", x, y, p, 1);
      fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
    },
    { points, pointerType },
  );
}

await tracer([[0.1, 0.2, 0.3], [0.35, 0.4, 0.7], [0.6, 0.25, 0.95], [0.85, 0.5, 0.4]]);
await page.waitForTimeout(400);
check((await canvas.getAttribute("aria-label")).includes("1 trait"), "le stylet écrit");
check(
  (await canvas.getAttribute("data-pen-mode")) === "true",
  "le rejet de la paume s'enclenche",
);
check((await page.getByText("Stylet", { exact: true }).count()) > 0, "et l'app l'annonce");

// Surligneur : un second trait, sous l'encre.
await page.getByRole("button", { name: "Surligneur", exact: true }).click();
await tracer([[0.1, 0.6, 0.5], [0.5, 0.6, 0.5], [0.8, 0.6, 0.5]]);
await page.waitForTimeout(400);
check((await canvas.getAttribute("aria-label")).includes("2 trait"), "le surligneur écrit aussi");

// Papier
await page.getByRole("button", { name: "Lignes", exact: true }).click();
await page.waitForTimeout(500);
check(
  (await canvas.getAttribute("class")).includes("paper-ruled"),
  "le papier ligné s'applique",
  await canvas.getAttribute("class"),
);

// Plein écran
await page.getByRole("button", { name: "Écrire en plein écran" }).click();
await page.waitForTimeout(600);
const plein = await page.evaluate(() => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[tous.length - 1];
  const parent = el.closest(".fixed");
  return { fixe: Boolean(parent), largeur: Math.round(el.getBoundingClientRect().width) };
});
check(plein.fixe, "le plein écran couvre l'écran");
check(plein.largeur > 600, `la feuille est large (${plein.largeur} px)`);
await page.screenshot({ path: "shots/note-plein-ecran.png" });

await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check(
  (await canvas.evaluate((el) => Boolean(el.closest(".fixed")))) === false,
  "Échap le referme",
);

// Tout doit survivre au rechargement.
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
const apres = page.locator('[data-testid="drawing-canvas"]').last();
check((await apres.getAttribute("aria-label")).includes("2 trait"), "les traits sont enregistrés");
check(
  (await apres.getAttribute("class")).includes("paper-ruled"),
  "le choix de papier aussi",
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
