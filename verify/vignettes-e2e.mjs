/*
 * Vignettes et organisation de la liste des notes.
 *
 * Le point : une liste de titres ne dit rien, deux notes de cours se
 * ressemblent jusqu'à ce qu'on voie leur première page. Et l'aperçu doit rester
 * léger — c'est tout l'intérêt de le stocker à part.
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("   erreur page :", String(e).slice(0, 150)); ko++; });

async function tracer() {
  await page.evaluate(() => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    const el = tous[tous.length - 1];
    const r = el.getBoundingClientRect();
    const fire = (type, x, y, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: 0.7, buttons,
          clientX: r.left + r.width * x, clientY: r.top + r.height * y,
        }),
      );
    for (const base of [0.2, 0.35, 0.5]) {
      fire("pointerdown", 0.15, base, 1);
      for (const x of [0.35, 0.55, 0.75]) fire("pointermove", x, base + 0.02, 1);
      fire("pointerup", 0.75, base, 0);
    }
  });
  await page.waitForTimeout(1600);
}

// --- Une note manuscrite ------------------------------------------------------
section("préparation");
const MANUSCRITE = `Écrite ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(MANUSCRITE);
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(1200);
// Une note neuve porte déjà sa page manuscrite : ajouter un croquis en ferait deux.
await page.waitForSelector('[data-testid="drawing-canvas"]');
await tracer();
check(true, "note manuscrite créée");

// --- Une note avec document ----------------------------------------------------
const DOCUMENT = `Polycopié ${Date.now()}`;
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(DOCUMENT);
// Le titre s'enregistre à la sortie du champ ; `setInputFiles` ne le quitte pas.
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(1200);
await page.locator('input[type="file"][accept*=".pdf"]:not([data-page-image])').setInputFiles("doc-test.pdf");
await page.waitForTimeout(7000);
check(true, "note avec document créée");

// --- Les vignettes ---------------------------------------------------------------
section("vignettes");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const carteManuscrite = page.locator("li").filter({ hasText: MANUSCRITE }).first();
const encreVignette = await carteManuscrite
  .locator('canvas[aria-label="Aperçu de la page manuscrite"]')
  .evaluate((el) => {
    const cx = el.getContext("2d");
    const d = cx.getImageData(0, 0, el.width, el.height).data;
    let encre = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) encre++;
    return { taille: `${el.width}x${el.height}`, encre };
  });
check(
  encreVignette.encre > 500,
  "la note manuscrite montre son écriture en vignette",
  JSON.stringify(encreVignette),
);

const carteDocument = page.locator("li").filter({ hasText: DOCUMENT }).first();
check(
  (await carteDocument.locator('canvas[aria-label^="Page 1 du document"]').count()) === 1,
  "la note avec document montre sa première page",
);

// --- Le poids : c'est l'objet même de l'aperçu stocké --------------------------
section("poids");
const poids = await page.evaluate(async () => {
  const r = await fetch("/notes", { headers: { "RSC": "1" } });
  return (await r.text()).length;
});
check(poids < 400000, `la liste reste légère (${Math.round(poids / 1024)} Ko)`);

// --- Tailles d'affichage --------------------------------------------------------
section("tailles d'affichage");
for (const [vue, label] of [["list", "Liste"], ["small", "Petites vignettes"], ["large", "Grandes vignettes"]]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(800);
  check(
    vue === "large" ? !page.url().includes("vue=") : page.url().includes(`vue=${vue}`),
    `« ${label} » se retrouve dans l'adresse`,
    page.url(),
  );
  check(
    (await page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed")) === "true",
    `et le bouton le reflète`,
  );
}
await page.screenshot({ path: "shots/notes-vignettes.png" });

// La vue liste doit vraiment changer la mise en page.
await page.getByRole("button", { name: "Liste", exact: true }).click();
await page.waitForTimeout(800);
const liste = () => page.locator("li").filter({ has: page.locator("a[href^='/notes/']") }).first();
const enListe = await liste().evaluate((el) => el.getBoundingClientRect().width);
await page.getByRole("button", { name: "Grandes vignettes", exact: true }).click();
await page.waitForTimeout(800);
const enGrille = await liste().evaluate((el) => el.getBoundingClientRect().width);
check(enListe > enGrille * 1.5, "la liste occupe toute la largeur, la grille non", `${enListe} / ${enGrille}`);

// --- Tri -------------------------------------------------------------------------
section("tri");
const titres = async () =>
  page.locator("a[href^='/notes/']").evaluateAll((els) =>
    els.map((e) => e.innerText.split("\n")[0].trim()),
  );

await page.selectOption('select[aria-label="Trier les notes"]', "title");
await page.waitForTimeout(900);
check(page.url().includes("tri=title"), "le tri vit dans l'adresse", page.url());
const parTitre = await titres();
/*
 * Même comparaison que l'application : les accents ne changent pas le rang,
 * les nombres se comparent comme des nombres, et les notes **sans titre** vont
 * à la fin — une liste alphabétique ne s'interrompt pas au milieu par un tas
 * d'étiquettes provisoires.
 */
const SANS_TITRE = "Note sans titre";
const rang = (t) => (t === SANS_TITRE ? "\uffff" : t.trim() || "\uffff");
const trie = [...parTitre].sort((a, b) =>
  rang(a).localeCompare(rang(b), "fr", {
    sensitivity: "base",
    numeric: true,
  }),
);
check(
  JSON.stringify(parTitre) === JSON.stringify(trie),
  "les notes sont bien rangées par titre",
  JSON.stringify({ obtenu: parTitre, attendu: trie }),
  JSON.stringify(parTitre.slice(0, 4)),
);

await page.selectOption('select[aria-label="Trier les notes"]', "updated");
await page.waitForTimeout(900);
check(!page.url().includes("tri="), "revenir au tri par défaut nettoie l'adresse", page.url());

// --- L'affichage survit au rechargement -------------------------------------------
section("persistance");
await page.getByRole("button", { name: "Petites vignettes", exact: true }).click();
await page.waitForTimeout(700);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
check(
  (await page.getByRole("button", { name: "Petites vignettes", exact: true }).getAttribute("aria-pressed")) === "true",
  "la taille choisie survit au rechargement",
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
