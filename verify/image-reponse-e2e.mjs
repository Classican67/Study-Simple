/*
 * Une réponse illustrée : le texte et l'image doivent cohabiter.
 *
 * Un schéma de cours fait souvent deux à trois fois plus large que haut. Côte
 * à côte avec le texte, sa colonne ne peut pas descendre sous la largeur de
 * l'image (`min-width: auto` sur un élément flex), alors que la colonne de
 * texte, elle, se laisse réduire à rien : la réponse sortait à 2 px de large
 * pour 3364 px de haut — une lettre par ligne, le schéma par-dessus. Aucune
 * mesure existante ne le voyait : il n'y a aucun débordement, ni horizontal ni
 * vertical, et toutes les classes attendues étaient bien dans le code.
 *
 * Les deux cas se vérifient ensemble, sinon « corriger » revient à tout
 * empiler :
 *   - un schéma large passe **sous** le texte et garde sa taille ;
 *   - une petite image reste **à côté** du texte.
 *
 * Chaque essai fabrique son propre paquet — titre horodaté, jamais une carte
 * existante : la base de vérification porte les traces des essais précédents.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

// La part minimale de la rangée qui doit rester au texte quand les deux sont
// côte à côte, et la largeur sous laquelle une colonne ne se lit plus.
const PART_MIN = 0.4;
const LARGEUR_MIN = 200;

// Plus de 260 caractères : c'est le seuil au-delà duquel la carte propose
// « Voir en entier », et cette modale se mesure aussi.
const DEFINITION = [
  "Compression : le gain diminue quand le niveau d'entrée augmente, ce qui réduit la dynamique utile du signal",
  "Aux faibles niveaux, la courbe reste linéaire et l'amplification est maximale",
  "Aux forts niveaux de pression, la saturation écrête les sommets de la sinusoïde",
  "Le temps est en abscisse, l'amplitude en dB SPL en ordonnée",
];

let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const section = (titre) => console.log(`\n── ${titre} ──`);

/*
 * Mesure la rangée « texte + image » d'une réponse. `page.evaluate` reçoit une
 * expression auto-appelée : une chaîne « (sel) => … » rendrait la fonction,
 * jamais son résultat.
 */
const MESURE = `(() => {
  // La modale est portée ailleurs dans le document : quand elle est ouverte,
  // c'est elle qu'on mesure, pas la carte restée derrière.
  const racine = document.querySelector('[role="dialog"]') ?? document;
  const img = racine.querySelector('img[alt*="Illustration"]');
  if (!img) return { absent: true };
  const bouton = img.closest("button");
  const rangee = bouton.parentElement;
  const texte = rangee.firstElementChild;
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  // Le texte et l'image ne doivent jamais se recouvrir. Comparer les seules
  // abscisses accuserait à tort une image passée à la ligne : il faut
  // l'intersection des deux rectangles.
  const a = texte.getBoundingClientRect();
  const b = bouton.getBoundingClientRect();
  return {
    img: r(img), texte: r(texte), rangee: r(rangee),
    chevauche: a.right > b.left + 0.5 && b.right > a.left + 0.5 && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5,
    // Une image plus large que sa rangée déborde de la carte.
    deborde: Math.round(b.width - rangee.getBoundingClientRect().width),
  };
})()`;

/** @param attendu "côte à côte", "empilés", ou null si l'un ou l'autre convient. */
function juger(ou, m, attendu) {
  if (m.absent) return check(false, `${ou} : image introuvable`);
  const part = m.texte.w / m.rangee.w;
  // Côte à côte : les deux se partagent la même bande horizontale.
  const cote = m.img.y < m.texte.y + m.texte.h && m.texte.y < m.img.y + m.img.h;
  const dispo = cote ? "côte à côte" : "empilés";
  const raisons = [];
  if (m.chevauche) raisons.push("le texte passe sous l'image");
  if (m.deborde > 0) raisons.push(`l'image déborde de ${m.deborde} px`);
  if (m.texte.w < LARGEUR_MIN) raisons.push(`colonne de texte à ${m.texte.w} px`);
  if (cote && part < PART_MIN) raisons.push(`le texte tombe à ${Math.round(part * 100)} % de la rangée`);
  if (attendu && dispo !== attendu) raisons.push(`${dispo} au lieu de ${attendu}`);
  check(
    raisons.length === 0,
    `${ou} — texte ${m.texte.w} px (${Math.round(part * 100)} %), image ${m.img.w}×${m.img.h}, ${dispo}`,
    raisons.join(" ; "),
  );
}

const browser = await chromium.launch();

/** Un paquet neuf, d'une seule carte, illustrée du fichier donné. */
async function creerPaquet(titre, fichier) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Nouveau paquet|^Paquet$/ }).first().click();
  await page.locator("#deck-title").fill(titre);
  await page.getByRole("button", { name: "Créer le paquet" }).click();
  await page.waitForURL(/\/decks\/[a-z0-9]+/, { timeout: 15000 });
  const url = page.url();

  await page.getByRole("button", { name: "Ajouter une carte" }).click();
  await page.waitForTimeout(800);
  await page.locator('[aria-label="Terme de la carte 1"]').click();
  await page.keyboard.type("Courbe de compression");
  await page.locator('[aria-label="Définition de la carte 1"]').click();
  for (const [i, ligne] of DEFINITION.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(`- ${ligne}`);
  }
  await page.locator("h1").first().click();
  await page.waitForTimeout(2500);

  await page.locator('input[type="file"]:not([capture])').first().setInputFiles(fichier);
  await page.waitForSelector('[role="application"]', { timeout: 10000 });
  await page.getByRole("button", { name: /Valider|Utiliser|Confirmer/ }).first().click();
  await page.waitForTimeout(2500);

  const forme = await page
    .locator('img[alt^="Illustration"]')
    .first()
    .evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
  await ctx.close();
  return { url, forme };
}

/** La réponse, sur trois écrans et deux thèmes. */
async function mesurerReponse(prefixe, deckUrl, ecrans, attendu) {
  for (const [nom, w, h, attenduEcran = attendu] of ecrans) {
    section(`${prefixe} · ${nom}`);
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      const vue = await ctx.newPage();
      await vue.goto(`${deckUrl}/study?all=1`, { waitUntil: "networkidle" });
      await vue.waitForTimeout(500);

      await vue.locator('[role="button"]').filter({ hasText: "Question" }).first().click();
      await vue.waitForTimeout(900);
      juger(`carte ${theme}`, await vue.evaluate(MESURE), attenduEcran);
      await vue.screenshot({ path: `shots/image-reponse-${prefixe}-carte-${nom}-${theme}.png` });

      const voir = vue.getByRole("button", { name: "Voir en entier", exact: true });
      if (await voir.count()) {
        await voir.click();
        await vue.waitForTimeout(500);
        juger(`modale ${theme}`, await vue.evaluate(MESURE), attenduEcran);
        await vue.screenshot({ path: `shots/image-reponse-${prefixe}-modale-${nom}-${theme}.png` });
      } else {
        check(false, `modale ${theme} : « Voir en entier » absent`, "la réponse n'est plus jugée longue");
      }
      await ctx.close();
    }
  }
}

// Sur téléphone, tout s'empile : c'est la mise en page en colonne, et elle ne
// dit rien du choix fait sur les écrans larges.
const ECRANS = [
  ["portable", 1440, 900],
  ["iPad-paysage", 1194, 834],
  ["iPhone", 393, 852, "empilés"],
];

// --- Un schéma large : il passe sous le texte et garde sa taille ------------
section("préparation · schéma large");
const large = await creerPaquet(`Schéma large ${Date.now()}`, "schema-large.png");
check(
  large.forme.w / large.forme.h > 2,
  `le schéma est large (${large.forme.w}×${large.forme.h}, rapport ${(large.forme.w / large.forme.h).toFixed(1)})`,
  "sans une image large, le défaut ne se reproduit pas",
);
await mesurerReponse("large", large.url, ECRANS, "empilés");

// --- Une petite image : elle reste à côté du texte --------------------------
section("préparation · petite image");
const petite = await creerPaquet(`Petite image ${Date.now()}`, "photo.png");
check(
  petite.forme.w / petite.forme.h < 2,
  `l'image est de format ordinaire (${petite.forme.w}×${petite.forme.h})`,
);
await mesurerReponse("petite", petite.url, ECRANS, "côte à côte");

await browser.close();
console.log(
  ko === 0
    ? "\nTexte et image cohabitent. Puis ouvrir shots/image-reponse-*.png."
    : `\n${ko} contrôle(s) en échec.`,
);
process.exit(ko ? 1 : 0);
