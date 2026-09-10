import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};

// Titre unique : un essai précédent interrompu laisserait sinon une note
// homonyme, et l'assertion finale accuserait la suppression à tort.
const TITRE = `Thermodynamique ${Date.now()}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 140)); ko++; });

// --- 1. Créer une note ------------------------------------------------------
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const url = page.url();
check(true, "la note est créée et ouverte");
check(
  (await page.locator('[aria-label^="Bloc paragraphe"]').count()) === 1,
  "elle commence par un bloc de texte, prêt à écrire",
);

// --- 2. Titre et texte enrichi ----------------------------------------------
await page.getByLabel("Titre de la note").fill(TITRE);
await page.locator('[aria-label^="Bloc paragraphe"]').click();
await page.locator('[aria-label^="Bloc paragraphe"]').pressSequentially("Premier principe");
await page.getByRole("button", { name: "Titre", exact: true }).first().click();
await page.waitForTimeout(300);
check(
  (await page.locator('[aria-label^="Bloc titre"]').count()) === 1,
  "le style du bloc passe en titre",
);

// --- 3. Tableau et formules -------------------------------------------------
await page.getByRole("button", { name: "Tableau", exact: true }).last().click();
await page.waitForTimeout(900);
check((await page.locator("table").count()) === 1, "un bloc tableau est ajouté");

// La grille par défaut fait trois lignes : on en ajoute une pour le total.
await page.getByRole("button", { name: "Ligne", exact: true }).click();
await page.waitForTimeout(300);
check(
  (await page.getByLabel("A4", { exact: true }).count()) === 1,
  "le bouton « Ligne » ajoute une ligne",
);

await page.getByLabel("A1", { exact: true }).fill("Note");
await page.getByLabel("A2", { exact: true }).fill("12");
await page.getByLabel("A3", { exact: true }).fill("15");
await page.getByLabel("A4", { exact: true }).fill("=SOMME(A2:A3)");
await page.getByLabel("B4", { exact: true }).click();
await page.waitForTimeout(300);
check(
  (await page.getByLabel("A4", { exact: true }).inputValue()) === "27",
  "la formule affiche son résultat une fois quittée",
  await page.getByLabel("A4", { exact: true }).inputValue(),
);
await page.getByLabel("A4", { exact: true }).click();
await page.waitForTimeout(200);
check(
  (await page.getByLabel("A4", { exact: true }).inputValue()) === "=SOMME(A2:A3)",
  "et redevient sa formule quand on l'édite",
);
await page.getByLabel("B4", { exact: true }).click();

// Une erreur doit se voir sans casser le reste de la grille.
await page.getByLabel("B2", { exact: true }).fill("=1/0");
await page.getByLabel("B3", { exact: true }).click();
await page.waitForTimeout(300);
check(
  (await page.getByLabel("B2", { exact: true }).inputValue()) === "#DIV0",
  "une division par zéro est signalée",
);
check(
  (await page.getByLabel("A4", { exact: true }).inputValue()) === "27",
  "sans contaminer les autres cellules",
);

// --- 4. Croquis au stylet ---------------------------------------------------
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForTimeout(900);
const canvas = page.locator('[data-testid="drawing-canvas"]');
check((await canvas.count()) === 1, "un bloc croquis est ajouté");

/** Trace au stylet en émettant de vrais PointerEvent de type « pen ». */
async function drawWithPen(points, pointerType = "pen") {
  await page.evaluate(
    ({ points, pointerType }) => {
      const el = document.querySelector('[data-testid="drawing-canvas"]');
      const rect = el.getBoundingClientRect();
      const fire = (type, x, y, pressure, buttons) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType,
            isPrimary: true,
            pressure,
            buttons,
            clientX: rect.left + rect.width * x,
            clientY: rect.top + rect.height * y,
          }),
        );
      fire("pointerdown", points[0][0], points[0][1], points[0][2], 1);
      for (const [x, y, p] of points.slice(1)) fire("pointermove", x, y, p, 1);
      fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
    },
    { points, pointerType },
  );
}

await drawWithPen([
  [0.1, 0.2, 0.3],
  [0.3, 0.5, 0.6],
  [0.6, 0.3, 0.9],
  [0.8, 0.6, 0.4],
]);
await page.waitForTimeout(300);
check(
  (await canvas.getAttribute("aria-label")).includes("1 trait"),
  "le stylet trace un trait",
  await canvas.getAttribute("aria-label"),
);
check(
  (await page.getByText("Stylet", { exact: true }).count()) > 0,
  "et l'app signale qu'elle est passée en mode stylet",
);

// Rejet de la paume : après un stylet, le doigt ne doit plus rien tracer.
await drawWithPen(
  [
    [0.2, 0.8, 0.5],
    [0.5, 0.9, 0.5],
    [0.7, 0.8, 0.5],
  ],
  "touch",
);
await page.waitForTimeout(300);
check(
  (await canvas.getAttribute("aria-label")).includes("1 trait"),
  "le doigt ne dessine plus une fois le stylet détecté",
  await canvas.getAttribute("aria-label"),
);

// Annuler / rétablir
await page.getByRole("button", { name: "Annuler le dernier trait" }).click();
await page.waitForTimeout(200);
check((await canvas.getAttribute("aria-label")).includes("0 trait"), "l'annulation retire le trait");
await page.getByRole("button", { name: "Rétablir le trait annulé" }).click();
await page.waitForTimeout(200);
check((await canvas.getAttribute("aria-label")).includes("1 trait"), "le rétablissement le remet");

await page.screenshot({ path: "shots/note-editeur.png", fullPage: true });

// --- 5. Tout doit survivre au rechargement ----------------------------------
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });

check(
  (await page.getByLabel("Titre de la note").inputValue()) === TITRE,
  "le titre est enregistré",
);
check(
  (await page.locator('[aria-label^="Bloc titre"]').innerText()).includes("Premier principe"),
  "le texte et son style sont enregistrés",
);
check(
  (await page.getByLabel("A4", { exact: true }).inputValue()) === "27",
  "le tableau et ses formules sont enregistrés",
);
check(
  (await page.locator('[data-testid="drawing-canvas"]').getAttribute("aria-label")).includes("1 trait"),
  "le croquis est enregistré",
);
check(
  (await page.locator("section[aria-label^='Bloc']").count()) === 3,
  "les trois blocs sont là",
  String(await page.locator("section[aria-label^='Bloc']").count()),
);

// --- 6. La note apparaît dans la liste --------------------------------------
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const carte = page.locator("a", { hasText: TITRE }).first();
check(await carte.count() > 0, "la note figure dans la liste");
await page.screenshot({ path: "shots/notes-liste.png" });

// --- 7. Suppression ---------------------------------------------------------
await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Supprimer la note" }).click();
await page.getByRole("button", { name: "Supprimer", exact: true }).click();
await page.waitForURL(`${BASE}/notes`);
check(
  (await page.locator("a", { hasText: TITRE }).count()) === 0,
  "la note supprimée disparaît de la liste",
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
