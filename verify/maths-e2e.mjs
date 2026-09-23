/*
 * Les caractères mathématiques d'une carte.
 *
 * Le pari du choix fait ici est qu'un symbole n'est **rien d'autre que du
 * texte** : pas de nouvelle syntaxe, donc rien à changer dans le balisage, la
 * relecture, la recherche ou l'export. Les tests unitaires le prouvent sur le
 * papier (tests/maths.test.ts, chaque symbole y fait l'aller-retour). Ce
 * qu'ils ne peuvent pas prouver, c'est ce qui se passe dans un vrai
 * navigateur, et c'est là que tout se joue :
 *
 *  - `execCommand("insertText")` n'existe pas sous jsdom ; c'est pourtant lui
 *    qui décide **où** le symbole atterrit et s'il hérite du gras ;
 *  - le champ de recherche de la palette prend le focus, et un
 *    `contenteditable` qui perd le focus perd sa sélection : sans mémoire du
 *    curseur, le symbole tombe au début du texte ;
 *  - la barre d'outils des cartes est masquée hors focus, donc la palette
 *    disparaîtrait avec elle au moindre faux pas ;
 *  - et rien de tout cela n'est vu par `audit.mjs`, qui ne mesure que les
 *    états qu'il visite : la palette n'existe qu'ouverte.
 *
 * On mesure donc aussi ici le contraste, les cibles tactiles et le
 * débordement, en clair et en sombre, sur téléphone et en desktop.
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
const dire = (label, valeur) => console.log(`   ${label} : ${valeur}`);
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();

const T = Date.now();
const OWNER = sql("select id from User order by createdAt limit 1;");
const DECK = `maths${T}`;
sql(
  `insert into Deck (id, ownerId, title, updatedAt) values ('${DECK}', '${OWNER}', 'Maths ${T}', ${T});` +
    [0, 1, 2]
      .map(
        (i) =>
          `insert into Card (id, deckId, term, definition, position, updatedAt) values ('${DECK}c${i}', '${DECK}', '', 'd', ${i}, ${T});`,
      )
      .join(""),
);

const browser = await chromium.launch();

/*
 * Le contraste se mesure par un canevas.
 *
 * Chromium rend les couleurs calculées en `oklch()` ; les lire comme du RGB
 * donne des rapports absurdes. Même mesure que dans `audit.mjs`, restreinte au
 * panneau — c'est lui qu'`audit.mjs` ne voit pas.
 */
const MESURER = `
(() => {
  const panneau = document.querySelector('[data-testid="palette-maths"]');
  if (!panneau) return { absent: true };
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRgb = (color) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
    }
    return getComputedStyle(document.body).backgroundColor || "#fff";
  };

  const contrastes = [];
  for (const el of panneau.querySelectorAll("p,span,input")) {
    const brut = el instanceof HTMLInputElement ? el.placeholder : el.textContent;
    const texte = String(brut ?? "").trim();
    if (!texte || el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const taille = parseFloat(cs.fontSize);
    const gras = parseInt(cs.fontWeight, 10) >= 700;
    const besoin = taille >= 24 || (taille >= 18.66 && gras) ? 3 : 4.5;
    const valeur = ratio(toRgb(cs.color), toRgb(bgOf(el)));
    if (valeur < besoin) contrastes.push({ texte: texte.slice(0, 24), valeur: valeur.toFixed(2), besoin });
  }

  const petits = [];
  for (const el of panneau.querySelectorAll("button")) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      petits.push({
        nom: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20),
        taille: Math.round(r.width) + "x" + Math.round(r.height),
      });
    }
  }

  const sansNom = [...panneau.querySelectorAll("button")].filter(
    (b) => !(b.getAttribute("aria-label") || "").trim(),
  ).length;

  const r = panneau.getBoundingClientRect();
  return {
    contrastes,
    petits,
    sansNom,
    boutons: panneau.querySelectorAll("button").length,
    debord: Math.max(0, Math.round(r.right - document.documentElement.clientWidth), Math.round(-r.left)),
    // Le panneau défile : c'est ce qui l'empêche de sortir par le bas.
    defile: panneau.scrollHeight > panneau.clientHeight + 1,
    hauteur: Math.round(r.height),
    pageDeborde: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()
`;

/** Ouvre l'éditeur d'une carte et déplie la palette. */
async function ouvrirPalette(page, carte = 1) {
  const champ = page.locator(`[aria-label="Terme de la carte ${carte}"]`);
  await champ.click();
  await page.getByRole("button", { name: "Caractères mathématiques" }).first().click();
  await page.waitForSelector('[data-testid="palette-maths"]');
  await page.waitForTimeout(250);
}

// --- 1. Poser un symbole ------------------------------------------------------
section("poser un symbole");

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/decks/${DECK}`, { waitUntil: "networkidle" });

/** Place le curseur après le n-ième caractère du champ. */
const curseurApres = (label, n) =>
  page.evaluate(
    ({ label, n }) => {
      const root = document.querySelector(`[aria-label="${label}"]`);
      const marcheur = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let vu = 0;
      for (let noeud = marcheur.nextNode(); noeud; noeud = marcheur.nextNode()) {
        const l = noeud.textContent.length;
        if (n <= vu + l) {
          const range = document.createRange();
          range.setStart(noeud, n - vu);
          range.collapse(true);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return true;
        }
        vu += l;
      }
      return false;
    },
    { label, n },
  );

const champ1 = page.locator('[aria-label="Terme de la carte 1"]');
await champ1.click();
await champ1.pressSequentially("aire = r");
await curseurApres("Terme de la carte 1", 7);
await page.getByRole("button", { name: "Caractères mathématiques" }).first().click();
await page.waitForSelector('[data-testid="palette-maths"]');
await page.getByRole("button", { name: "pi", exact: true }).click();
await page.waitForTimeout(150);
const milieu = (await champ1.innerText()).trim();
// Le curseur suit le symbole posé, comme après une frappe : le suivant va donc
// là où on le remet, à la fin.
await curseurApres("Terme de la carte 1", 9);
await page.getByRole("button", { name: "au carré", exact: true }).click();
await page.waitForTimeout(150);
// La palette se superpose à la carte suivante : on la referme avant d'y aller.
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

const apres = (await champ1.innerText()).trim();
dire("champ après insertion", `« ${milieu} » puis « ${apres} »`);
check(
  milieu === "aire = πr",
  "le symbole se pose **au curseur**, ni au début ni à la fin",
  `« ${milieu} » pour « aire = πr » — sans mémoire du curseur, il tombe au début`,
);
check(
  apres === "aire = πr²",
  "et le suivant là où on remet le curseur",
  `« ${apres} » pour « aire = πr² »`,
);

// --- 2. Il hérite de la mise en forme ------------------------------------------
section("un symbole tapé dans du gras est en gras");

const champ2 = page.locator('[aria-label="Terme de la carte 2"]');
await champ2.click();
await page.getByRole("button", { name: "Gras (Ctrl+B)" }).first().click();
await champ2.pressSequentially("angle ");
await page.getByRole("button", { name: "Caractères mathématiques" }).first().click();
await page.waitForSelector('[data-testid="palette-maths"]');
await page.getByRole("button", { name: "thêta", exact: true }).click();
await page.waitForTimeout(200);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const gras = await champ2.evaluate((el) =>
  [...el.querySelectorAll("b, strong")].some((n) => n.textContent.includes("θ")),
);
check(gras, "le symbole prend la mise en forme du curseur", await champ2.innerHTML());

// --- 3. La recherche -----------------------------------------------------------
section("chercher un symbole par son nom");

const champ3 = page.locator('[aria-label="Terme de la carte 3"]');
await champ3.click();
await champ3.pressSequentially("onde ");
await page.getByRole("button", { name: "Caractères mathématiques" }).first().click();
await page.waitForSelector('[data-testid="palette-maths"]');
const recherche = page.getByLabel("Chercher un caractère mathématique");
// Sans accent : c'est ce qu'on tape quand on cherche « bêta » ou « thêta ».
await recherche.fill("lambda");
await page.waitForTimeout(200);
const restants = await page.locator('[data-testid="palette-maths"] button').count();
dire("boutons après recherche", String(restants));
check(restants <= 3, "la recherche réduit la palette à ce qui correspond", `${restants} boutons`);
await page.getByRole("button", { name: "lambda", exact: true }).click();
await page.waitForTimeout(200);
check(
  (await champ3.innerText()).trim() === "onde λ",
  "et le symbole trouvé se pose",
  `« ${(await champ3.innerText()).trim()} »`,
);

await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// --- 4. Fermeture ---------------------------------------------------------------
section("la palette se ferme");

await ouvrirPalette(page, 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check(
  (await page.locator('[data-testid="palette-maths"]').count()) === 0,
  "Échap ferme la palette",
);
await ouvrirPalette(page, 1);
await page.getByRole("button", { name: "Caractères mathématiques" }).first().click();
await page.waitForTimeout(200);
check(
  (await page.locator('[data-testid="palette-maths"]').count()) === 0,
  "et son propre bouton la referme",
  "rouvert aussitôt : le clic « dehors » et la bascule se sont additionnés",
);

// --- 5. Les récents --------------------------------------------------------------
section("les symboles récents");
await ouvrirPalette(page, 1);
const recents = await page.evaluate(() => {
  const groupes = [...document.querySelectorAll('[data-testid="palette-maths"] > div')];
  const premier = groupes[0];
  return {
    titre: premier?.querySelector("p")?.textContent ?? "",
    symboles: [...(premier?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()),
  };
});
dire("premier groupe", `${recents.titre} : ${recents.symboles.join(" ")}`);
check(recents.titre === "Récents", "les derniers symboles posés reviennent en tête", recents.titre);
check(
  recents.symboles.includes("λ") && recents.symboles.includes("π"),
  "et ce sont bien ceux qu'on vient de poser",
  recents.symboles.join(" "),
);
await page.keyboard.press("Escape");

// --- 6. Ce qui est posé survit ----------------------------------------------------
section("ce qui est posé survit à la réouverture");

await page.locator("h1").first().click();
await page.waitForTimeout(900);
const stocke = sql(`select term from Card where id='${DECK}c0';`);
const stocke2 = sql(`select term from Card where id='${DECK}c1';`);
dire("en base", `« ${stocke} » et « ${stocke2} »`);
check(stocke === "aire = πr²", "la carte est enregistrée telle quelle, sans échappement", stocke);
check(stocke2 === "**angle θ**", "et le gras garde son symbole dedans", stocke2);

await page.reload({ waitUntil: "networkidle" });
const rouvert = await page.locator('[aria-label="Terme de la carte 1"]').innerText();
check(rouvert.trim() === "aire = πr²", "et la relecture ne montre ni barre oblique ni marqueur", rouvert);
const grasRouvert = await page
  .locator('[aria-label="Terme de la carte 2"]')
  .evaluate((el) => [...el.querySelectorAll("b, strong")].some((n) => n.textContent.includes("θ")));
check(grasRouvert, "le symbole en gras l'est toujours");

// La révision relit le même balisage par l'autre rendu.
const etude = await page.request.get(`${BASE}/decks/${DECK}/study?all=1`);
const html = await etude.text();
check(etude.ok() && html.includes("πr²"), "la révision affiche le symbole", String(etude.status()));

check(erreurs.length === 0, "aucune erreur de page", erreurs.join(" | "));
await ctx.close();

// --- 7. Ce qu'audit.mjs ne voit pas -------------------------------------------------
/*
 * La palette n'existe qu'ouverte : aucune passe d'audit ne la rencontre. On
 * refait donc ici ses trois mesures — contraste, cible tactile, débordement —
 * dans les quatre situations qui comptent.
 */
section("mesures : contraste, cibles, débordement");

for (const [nom, vp, dark] of [
  ["téléphone clair", { width: 393, height: 852 }, false],
  ["téléphone sombre", { width: 393, height: 852 }, true],
  ["desktop clair", { width: 1280, height: 900 }, false],
  ["desktop sombre", { width: 1280, height: 900 }, true],
]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
  await c.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/decks/${DECK}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await ouvrirPalette(p, 1);
  const m = await p.evaluate(MESURER);
  /*
   * Et une capture : une mesure qui passe ne dit pas que c'est lisible. Une
   * grille de cent symboles se juge à l'œil — l'espacement, l'alignement, la
   * taille des glyphes les uns à côté des autres.
   */
  const fichier = `shots/maths-${nom.replace(/\s+/g, "-")}.png`;
  await p.screenshot({ path: fichier });

  if (m.absent) {
    check(false, `${nom} — la palette est ouverte`, "panneau introuvable");
  } else {
    dire(nom, `${m.boutons} boutons, panneau de ${m.hauteur} px${m.defile ? ", défilant" : ""}`);
    check(m.contrastes.length === 0, `${nom} — tout se lit`, JSON.stringify(m.contrastes));
    check(m.petits.length === 0, `${nom} — chaque symbole fait 44 px`, JSON.stringify(m.petits.slice(0, 4)));
    check(m.sansNom === 0, `${nom} — chaque bouton a un nom`, `${m.sansNom} sans nom accessible`);
    check(m.debord === 0, `${nom} — le panneau ne sort pas de l'écran`, `${m.debord} px de trop`);
    check(!m.pageDeborde, `${nom} — et la page ne défile pas en largeur`);
    check(m.hauteur <= vp.height * 0.6, `${nom} — il laisse voir le texte qu'on écrit`, `${m.hauteur} px de haut`);
  }
  await c.close();
}

sql(`delete from Deck where id='${DECK}';`);
await browser.close();
console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
