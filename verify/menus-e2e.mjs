/*
 * Navigation dans les notes, menus contextuels et pastille « maîtrisée ».
 *
 * - Revenir d'une note ramène à **son dossier**, pas à la racine, et la liste
 *   garde son affichage.
 * - Clic droit, appui long au doigt, bouton ⋮ et clavier ouvrent le même menu,
 *   et chaque option fait ce qu'elle annonce : créer, renommer, dupliquer,
 *   ranger, déplacer, supprimer.
 * - L'appui long n'ouvre pas la note au lever du doigt, et un doigt qui glisse
 *   fait défiler au lieu d'ouvrir le menu.
 * - La pastille s'allume et s'éteint au choix, survit au rechargement, et ne
 *   fait pas remonter la note dans le tri par date.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();

const T = Date.now();
const PARENT = `Menus parent ${T}`;
const ENFANT = `Menus enfant ${T}`;
const AUTRE = `Menus autre ${T}`;
const NOTE = `Menus note ${T}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => check(false, "aucune erreur de page", String(e).slice(0, 160)));

const menu = () => page.getByRole("menu");
const lienDossier = (nom) => page.locator("a", { hasText: nom }).first();
const idDossier = (nom) => sql(`select id from Folder where name='${nom}' and kind='note';`);

async function creerDossierIci(nom) {
  await page.getByRole("button", { name: "Dossier", exact: true }).click();
  await page.locator('[role="dialog"] input[name="name"]').fill(nom);
  await page.getByRole("button", { name: "Créer" }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached" });
  await page.waitForTimeout(400);
}

/** Le menu tient-il entièrement dans l'écran ? */
async function menuDansEcran() {
  return page.evaluate(() => {
    const r = document.querySelector('[role="menu"]').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
}

// --- Clic droit sur un dossier ----------------------------------------------
section("clic droit sur un dossier");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await creerDossierIci(PARENT);
await creerDossierIci(AUTRE);
await page.reload({ waitUntil: "networkidle" });

await lienDossier(PARENT).click({ button: "right" });
await menu().waitFor();
check(
  (await page.getByRole("menuitem").allTextContents()).join("|").includes("Nouveau sous-dossier"),
  "le clic droit ouvre le menu du dossier",
);
check(await menuDansEcran(), "le menu tient dans l'écran");
check(
  await page.evaluate(() => document.activeElement?.getAttribute("role") === "menuitem"),
  "le focus est sur la première option",
);
check(page.url().endsWith("/notes"), "le clic droit n'ouvre pas le dossier", page.url());

await page.getByRole("menuitem", { name: "Nouveau sous-dossier" }).click();
await page.locator('[role="dialog"] input[name="name"]').fill(ENFANT);
await page.getByRole("button", { name: "Créer" }).click();
await page.locator('[role="dialog"]').waitFor({ state: "detached" });
const parentId = idDossier(PARENT);
const enfantId = idDossier(ENFANT);
check(
  Boolean(enfantId) && sql(`select parentId from Folder where id='${enfantId}';`) === parentId,
  "« Nouveau sous-dossier » crée le dossier dans celui-ci",
);

// --- Nouvelle note, puis retour à son dossier -------------------------------
section("revenir d'une note à son dossier");
await page.goto(`${BASE}/notes?folder=${parentId}&vue=list`, { waitUntil: "networkidle" });
await lienDossier(ENFANT).click({ button: "right" });
await page.getByRole("menuitem", { name: "Nouvelle note ici" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+$/);
const noteId = page.url().split("/").pop();
check(sql(`select folderId from Note where id='${noteId}';`) === enfantId, "« Nouvelle note ici » range la note dans le dossier");
await page.getByLabel("Titre de la note").fill(NOTE);
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(600);

const fil = page.getByRole("navigation", { name: "Fil d'Ariane" });
check(
  (await fil.innerText()).includes(PARENT) && (await fil.innerText()).includes(ENFANT),
  "la page de la note montre le chemin de son dossier",
  await fil.innerText(),
);
await page.getByRole("link", { name: `Revenir à « ${ENFANT} »` }).click();
await page.waitForURL(new RegExp(`folder=${enfantId}`));
check(true, "la flèche ramène au dossier de la note, pas à la racine");

// Le dossier parent, depuis le fil, garde l'affichage choisi.
await page.goto(`${BASE}/notes?folder=${enfantId}&vue=list`, { waitUntil: "networkidle" });
const versParent = await page.getByRole("link", { name: `Revenir à « ${PARENT} »` }).getAttribute("href");
check(
  versParent.includes(`folder=${parentId}`) && versParent.includes("vue=list"),
  "remonter d'un dossier garde l'affichage en liste",
  versParent,
);

// --- Clavier ------------------------------------------------------------------
section("au clavier");
const plus = page.getByRole("button", { name: `Options de la note « ${NOTE} »` });
await plus.focus();
await page.keyboard.press("Enter");
await menu().waitFor();
check((await plus.getAttribute("aria-expanded")) === "true", "le bouton ⋮ annonce le menu ouvert");
const premier = await page.evaluate(() => document.activeElement?.textContent);
await page.keyboard.press("ArrowDown");
const second = await page.evaluate(() => document.activeElement?.textContent);
check(premier !== second && second, "les flèches parcourent les options", `${premier} → ${second}`);
await page.keyboard.press("Escape");
await menu().waitFor({ state: "detached" });
check(
  await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Options de la note")),
  "Échap referme et rend le focus au bouton",
);

// --- Pastille « maîtrisée » -------------------------------------------------
section("pastille « maîtrisée »");
const dateAvant = sql(`select updatedAt from Note where id='${noteId}';`);
await plus.click();
await page.getByRole("menuitem", { name: "Marquer comme maîtrisée" }).click();
await page.waitForTimeout(800);
const carte = page.locator("li", { has: page.locator(`a[href="/notes/${noteId}"]`) });
check((await carte.innerText()).includes("Maîtrisée"), "la pastille apparaît sur la carte");
check(sql(`select mastered from Note where id='${noteId}';`) === "1", "et elle est enregistrée");
check(
  sql(`select updatedAt from Note where id='${noteId}';`) === dateAvant,
  "marquer la note ne change pas sa date de modification",
  `${dateAvant} → ${sql(`select updatedAt from Note where id='${noteId}';`)}`,
);

await page.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
const bascule = page.getByRole("button", { name: "Maîtrisée", exact: true });
check((await bascule.getAttribute("aria-pressed")) === "true", "la page de la note la montre allumée");
await bascule.click();
await page.waitForTimeout(800);
await page.reload({ waitUntil: "networkidle" });
check(
  (await page.getByRole("button", { name: "Maîtrisée", exact: true }).getAttribute("aria-pressed")) === "false",
  "éteinte depuis la note, elle le reste après rechargement",
);
await page.getByRole("button", { name: "Maîtrisée", exact: true }).click();
await page.waitForTimeout(800);
check(sql(`select mastered from Note where id='${noteId}';`) === "1", "et se rallume au choix");

// --- Renommer, dupliquer ------------------------------------------------------
section("renommer et dupliquer");
await page.goto(`${BASE}/notes?folder=${enfantId}`, { waitUntil: "networkidle" });
await page.locator(`a[href="/notes/${noteId}"]`).click({ button: "right" });
await page.getByRole("menuitem", { name: "Renommer" }).click();
await page.getByLabel("Titre", { exact: true }).fill(`${NOTE} renommée`);
await page.getByRole("button", { name: "Renommer" }).click();
await page.locator('[role="dialog"]').waitFor({ state: "detached" });
await page.waitForTimeout(500);
check(sql(`select title from Note where id='${noteId}';`) === `${NOTE} renommée`, "« Renommer » renomme la note");
check(
  await page.locator(`a[href="/notes/${noteId}"]`, { hasText: `${NOTE} renommée` }).isVisible(),
  "et la carte suit",
);

await page.locator(`a[href="/notes/${noteId}"]`).click({ button: "right" });
await page.getByRole("menuitem", { name: "Dupliquer" }).click();
await page.waitForTimeout(1200);
const copies = sql(`select id||'|'||title||'|'||mastered from Note where folderId='${enfantId}' and id<>'${noteId}';`);
check(copies.includes(`${NOTE} renommée (copie)|0`), "« Dupliquer » crée une copie, sans la pastille", copies);
check(
  sql(`select count(*) from NoteBlock where noteId='${copies.split("|")[0]}';`) ===
    sql(`select count(*) from NoteBlock where noteId='${noteId}';`),
  "la copie reprend tous les blocs",
);
check((await page.locator("ul li a[href^='/notes/']").count()) === 2, "et elle apparaît dans la liste");

// --- Appui long au doigt ------------------------------------------------------
section("appui long au doigt");
/** Envoie un geste tactile sur l'élément. `glisse` : distance parcourue avant le lever. */
async function geste(selecteur, { duree, glisse = 0 }) {
  return page.evaluate(
    async ({ selecteur, duree, glisse }) => {
      const el = document.querySelector(selecteur);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 3;
      const y = r.top + r.height / 2;
      const fire = (type, dx = 0) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch",
            isPrimary: true, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y + dx,
          }),
        );
      const attendre = (ms) => new Promise((res) => setTimeout(res, ms));
      fire("pointerdown");
      if (glisse) {
        await attendre(80);
        fire("pointermove", glisse);
      }
      await attendre(duree);
      fire("pointerup", glisse);
      // Le clic de compatibilité qui suit le lever du doigt.
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await attendre(150);
      return location.pathname + location.search;
    },
    { selecteur, duree, glisse },
  );
}

const avantUrl = new URL(page.url()).pathname + new URL(page.url()).search;
const apres = await geste(`a[href="/notes/${noteId}"]`, { duree: 650 });
check(await menu().isVisible(), "un appui long ouvre le menu");
check(apres === avantUrl, "et le lever du doigt n'ouvre pas la note", apres);
// Le premier choix fait dans le menu ne doit pas être avalé.
await page.getByRole("menuitem", { name: "Ranger dans un dossier" }).click();
check(await page.getByRole("dialog", { name: "Ranger la note" }).isVisible(), "le premier choix après l'appui long est pris");
await page.getByRole("button", { name: `${PARENT}`, exact: true }).click();
await page.waitForTimeout(900);
check(sql(`select folderId from Note where id='${noteId}';`) === parentId, "« Ranger » déplace la note dans le dossier choisi");

await page.goto(`${BASE}/notes?folder=${enfantId}`, { waitUntil: "networkidle" });
const copieId = copies.split("|")[0];
await geste(`a[href="/notes/${copieId}"]`, { duree: 650, glisse: 40 });
check(!(await menu().isVisible().catch(() => false)), "un doigt qui glisse fait défiler, sans ouvrir le menu");
await page.goto(`${BASE}/notes?folder=${enfantId}`, { waitUntil: "networkidle" });
const bref = await geste(`a[href="/notes/${copieId}"]`, { duree: 60 });
await page.waitForTimeout(600);
check(page.url().includes(`/notes/${copieId}`) || bref.includes(copieId), "un toucher bref ouvre la note, comme avant", page.url());

// --- Déplacer et supprimer un dossier ---------------------------------------
section("déplacer et supprimer");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await lienDossier(PARENT).click({ button: "right" });
await page.getByRole("menuitem", { name: "Déplacer" }).click();
const autreId = idDossier(AUTRE);
await page.locator("#move-destination").selectOption(autreId);
await page.getByRole("button", { name: "Déplacer", exact: true }).click();
await page.waitForTimeout(900);
check(sql(`select parentId from Folder where id='${parentId}';`) === autreId, "« Déplacer » range le dossier dans un autre");

await page.goto(`${BASE}/notes?folder=${parentId}`, { waitUntil: "networkidle" });
await lienDossier(ENFANT).click({ button: "right" });
await page.getByRole("menuitem", { name: "Supprimer" }).click();
await page.getByRole("button", { name: "Supprimer le dossier" }).click();
await page.waitForURL(new RegExp(`folder=${parentId}`));
await page.waitForTimeout(500);
check(!idDossier(ENFANT), "« Supprimer » efface le dossier");
check(
  sql(`select folderId is null from Note where id='${copieId}';`) === "1",
  "et la note qu'il contenait remonte à la racine, sans être effacée",
);

await page.goto(`${BASE}/notes?folder=${parentId}`, { waitUntil: "networkidle" });
await page.locator(`a[href="/notes/${noteId}"]`).click({ button: "right" });
await page.getByRole("menuitem", { name: "Supprimer" }).click();
await page.getByRole("button", { name: "Supprimer", exact: true }).click();
await page.waitForTimeout(1000);
check(sql(`select count(*) from Note where id='${noteId}';`) === "0", "« Supprimer » efface la note");
check((await page.locator(`a[href="/notes/${noteId}"]`).count()) === 0, "et la carte disparaît");

// --- Téléphone : le menu reste dans l'écran ---------------------------------
section("téléphone");
const tel = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
await tel.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const p2 = await tel.newPage();
await p2.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await p2.locator('button[aria-label^="Options du dossier"]').first().tap();
await p2.getByRole("menu").waitFor();
const place = await p2.evaluate(() => {
  const r = document.querySelector('[role="menu"]').getBoundingClientRect();
  return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), w: innerWidth, h: innerHeight };
});
check(place.l >= 8 && place.r <= place.w - 8 && place.b <= place.h, "le menu ouvert au bord droit tient dans l'écran", JSON.stringify(place));
await p2.locator("body").click({ position: { x: 20, y: 400 } });
check(!(await p2.getByRole("menu").isVisible().catch(() => false)), "toucher à côté referme le menu");
check(p2.url().endsWith("/notes"), "sans rien ouvrir dessous", p2.url());
await tel.close();

// Ménage : la base de vérification ne garde pas ce que l'essai a créé.
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
for (const nom of [AUTRE]) {
  const id = idDossier(nom);
  if (!id) continue;
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await lienDossier(nom).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await page.getByRole("button", { name: "Supprimer le dossier" }).click();
  await page.waitForTimeout(800);
}
if (copieId) sql(`delete from Note where id='${copieId}';`);

await browser.close();
console.log(ko === 0 ? "\nNavigation, menus et pastille font ce qu'ils annoncent." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
