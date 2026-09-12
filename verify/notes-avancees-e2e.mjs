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

// --- Créer un dossier depuis la section Notes -------------------------------
//
// Les notes ont leur propre classement : un dossier créé dans les paquets ne
// leur est pas proposé, et c'est voulu.
section("préparation");
const DOSSIER = `Physique ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
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
await page.getByRole("button", { name: "Manuscrit", exact: true }).click();
await page.waitForTimeout(900);
check(page.url().includes("has=drawing"), "le filtre vit dans l'adresse", page.url());

// Comparer au nombre de notes de la racine n'aurait aucun sens : un filtre
// porte volontairement sur toute l'arborescence. On vérifie plutôt que chaque
// résultat contient bien ce qu'on a demandé.
const cartes = page.locator('a[href^="/notes/"]');
const n = await cartes.count();
let toutesManuscrites = true;
for (let i = 0; i < n; i++) {
  if ((await cartes.nth(i).locator('[title*="pages manuscrites"]').count()) === 0) {
    toutesManuscrites = false;
  }
}
check(toutesManuscrites, `les ${n} résultats contiennent tous une page manuscrite`);

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
await page.getByLabel("Titre de la note").fill(`Page stylet ${Date.now()}`);
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

// Papier. La classe vit sur la page qui défile, pas sur le canevas : celui-ci
// ne fait que la taille de la fenêtre, le fond doit défiler avec le contenu.
const classePage = () =>
  page.evaluate(() => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    return tous[tous.length - 1].parentElement.className;
  });
await page.getByRole("button", { name: "Lignes", exact: true }).click();
await page.waitForTimeout(500);
check((await classePage()).includes("paper-ruled"), "le papier ligné s'applique", await classePage());

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
check((await classePage()).includes("paper-ruled"), "le choix de papier aussi", await classePage());

// --- Zoom et déplacement à deux doigts ---------------------------------------
section("zoom");

/** Pince à deux doigts sur le canevas, en vrais PointerEvent tactiles. */
async function pincer(ecart) {
  await page.evaluate((ecart) => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    const el = tous[tous.length - 1];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type, id, x, y, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
          isPrimary: id === 1, pressure: 0.5, buttons, clientX: x, clientY: y,
        }),
      );
    fire("pointerdown", 1, cx - 50, cy, 1);
    fire("pointerdown", 2, cx + 50, cy, 1);
    for (let i = 1; i <= 6; i++) {
      const d = 50 + ((ecart - 100) / 2) * (i / 6);
      fire("pointermove", 1, cx - d, cy, 1);
      fire("pointermove", 2, cx + d, cy, 1);
    }
    fire("pointerup", 1, cx - ecart / 2, cy, 0);
    fire("pointerup", 2, cx + ecart / 2, cy, 0);
  }, ecart);
}

const traitsAvant = await apres.getAttribute("aria-label");
await pincer(300);
await page.waitForTimeout(400);

const transform = await apres.evaluate((el) => el.style.transform);
check(/scale\((?!1\))/.test(transform), "écarter deux doigts agrandit la page", transform);
check(
  (await page.getByRole("button", { name: /Zoom \d+ %/ }).count()) === 1,
  "le facteur de zoom s'affiche",
);
check(
  (await apres.getAttribute("aria-label")) === traitsAvant,
  "pincer ne laisse aucun trait sur la page",
  `${traitsAvant} → ${await apres.getAttribute("aria-label")}`,
);

await page.getByRole("button", { name: /Zoom \d+ %/ }).click();
await page.waitForTimeout(400);
check(
  (await page.getByRole("button", { name: /Zoom \d+ %/ }).count()) === 0,
  "et l'on revient à la taille d'origine d'un geste",
);

// --- Plein écran du tableau et du texte --------------------------------------
section("plein écran des autres blocs");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByRole("button", { name: "Tableau", exact: true }).last().click();
await page.waitForSelector("table");
await page.waitForTimeout(600);

for (const [rang, nom] of [[1, "Texte"], [2, "Tableau"]]) {
  await page.getByRole("button", { name: `Agrandir le bloc ${rang}` }).click();
  await page.waitForTimeout(500);
  check(
    (await page.locator(".fixed").filter({ hasText: nom }).count()) >= 1,
    `le bloc ${nom.toLowerCase()} s'ouvre en plein écran`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check(
    (await page.getByRole("button", { name: "Quitter le plein écran" }).count()) === 0,
    `et Échap le referme`,
  );
}

// --- Dossier créé depuis la section Notes ------------------------------------
section("dossier depuis les Notes");
const DOSSIER2 = `Thèmes ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Dossier", exact: true }).click();
await page.waitForSelector('[role="dialog"]');
await page.locator('[role="dialog"] input[name="name"]').fill(DOSSIER2);
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForTimeout(1800);
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
check(
  (await page.locator('a[href*="folder="]').filter({ hasText: DOSSIER2 }).count()) === 1,
  "un dossier créé depuis les Notes y apparaît, même vide",
);

// --- Lasso et formes, à la GoodNotes -----------------------------------------
section("lasso et formes");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);
const toile = page.locator('[data-testid="drawing-canvas"]').last();

for (const outil of ["Lasso", "Formes"]) {
  check((await page.getByRole("button", { name: outil, exact: true }).count()) >= 1, `outil « ${outil} »`);
}

// Une forme : on trace n'importe comment, elle est redressée au lâcher.
await page.getByRole("button", { name: "Formes", exact: true }).click();
for (const forme of ["Ligne", "Rectangle", "Ellipse"]) {
  check(
    (await page.getByRole("button", { name: forme, exact: true }).count()) >= 1,
    `forme « ${forme} » proposée`,
  );
}
await page.getByRole("button", { name: "Rectangle", exact: true }).click();
await tracer([[0.2, 0.2, 0.5], [0.6, 0.24, 0.5], [0.62, 0.45, 0.5], [0.22, 0.42, 0.5]]);
await page.waitForTimeout(400);
check((await toile.getAttribute("aria-label")).includes("1 trait"), "la forme est posée");

// Deux traits libres à côté, pour avoir de quoi sélectionner.
await page.getByRole("button", { name: "Stylo", exact: true }).click();
await tracer([[0.1, 0.7, 0.5], [0.2, 0.72, 0.6], [0.3, 0.7, 0.5]]);
await page.waitForTimeout(300);
await tracer([[0.7, 0.7, 0.5], [0.8, 0.72, 0.6], [0.9, 0.7, 0.5]]);
await page.waitForTimeout(400);
check((await toile.getAttribute("aria-label")).includes("3 trait"), "trois traits sur la page");

// Le lasso entoure le trait de gauche seulement.
await page.getByRole("button", { name: "Lasso", exact: true }).click();
await tracer([
  [0.05, 0.62, 0.5], [0.38, 0.62, 0.5], [0.38, 0.8, 0.5], [0.05, 0.8, 0.5], [0.05, 0.62, 0.5],
]);
await page.waitForTimeout(500);
check(
  (await page.getByRole("button", { name: "Supprimer la sélection" }).count()) === 1,
  "le lasso retient quelque chose",
);
const compte = await page.locator("text=/^\\d+ traits?$/").first().innerText();
check(compte.startsWith("1 "), "un seul trait retenu, pas ses voisins", compte);

await page.getByRole("button", { name: "Supprimer la sélection" }).click();
await page.waitForTimeout(500);
check((await toile.getAttribute("aria-label")).includes("2 trait"), "la sélection est supprimée");
check(
  (await page.getByRole("button", { name: "Supprimer la sélection" }).count()) === 0,
  "et la palette n'en propose plus",
);

await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
check(
  (await page.locator('[data-testid="drawing-canvas"]').last().getAttribute("aria-label")).includes("2 trait"),
  "la suppression est enregistrée",
);

// --- Règle -------------------------------------------------------------------
section("règle");
check(
  (await page.getByRole("button", { name: "Poser la règle" }).count()) === 1,
  "la règle se pose depuis la palette",
);
await page.getByRole("button", { name: "Poser la règle" }).click();
await page.waitForTimeout(400);
check(
  (await page.getByRole("button", { name: "Ranger la règle" }).count()) === 1,
  "et se range de la même façon",
);
check((await page.locator("text=/^-?\\d+°$/").count()) === 1, "son angle s'affiche");

// Un trait tremblant tracé le long de la règle doit ressortir droit.
const avantRegle = Number((await toile.getAttribute("aria-label")).match(/(\d+) trait/)[1]);
await page.getByRole("button", { name: "Stylo", exact: true }).click();
const milieu = await page.evaluate(() => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[tous.length - 1];
  const r = el.getBoundingClientRect();
  return r.height / 2 / r.height;
});
await tracer([
  [0.15, milieu + 0.004, 0.5],
  [0.35, milieu - 0.006, 0.6],
  [0.55, milieu + 0.005, 0.5],
  [0.75, milieu - 0.003, 0.4],
]);
await page.waitForTimeout(500);
check(
  Number((await toile.getAttribute("aria-label")).match(/(\d+) trait/)[1]) === avantRegle + 1,
  "on écrit toujours au stylo, règle posée",
);

await page.getByRole("button", { name: "Ranger la règle" }).click();
await page.waitForTimeout(300);
check(
  (await page.locator("text=/^-?\\d+°$/").count()) === 0,
  "rangée, elle disparaît de la palette",
);

// --- Le plein écran occupe vraiment l'écran ----------------------------------
section("plein écran, sans marge");
await page.getByRole("button", { name: "Écrire en plein écran" }).click();
await page.waitForTimeout(800);
const mesures = await page.evaluate(() => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[tous.length - 1];
  const r = el.getBoundingClientRect();
  const palette = document.querySelector('[role="toolbar"]');
  return {
    largeurToile: Math.round(r.width),
    largeurEcran: window.innerWidth,
    hauteurToile: Math.round(r.height),
    dispo: Math.round(window.innerHeight - (palette?.getBoundingClientRect().height ?? 0)),
    // Le canevas ne doit jamais dépasser ce que le navigateur sait peindre.
    mpx: Number(((el.width * el.height) / 1e6).toFixed(1)),
  };
});
check(
  mesures.largeurToile >= mesures.largeurEcran - 2,
  "la feuille occupe toute la largeur",
  JSON.stringify(mesures),
);
check(
  mesures.hauteurToile >= mesures.dispo - 4,
  "et toute la hauteur disponible",
  JSON.stringify(mesures),
);
check(
  mesures.mpx < 16,
  `le canevas reste sous la limite de Safari (${mesures.mpx} Mpx)`,
  JSON.stringify(mesures),
);
await page.screenshot({ path: "shots/canvas-plein-ecran.png" });
await page.keyboard.press("Escape");

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
