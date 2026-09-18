/*
 * Gras, italique, couleur : ce qui est mis en forme doit le rester **à la
 * réouverture**, sans `**` ni `{c:…}` autour de la phrase.
 *
 * Les tests unitaires (tests/rich-editor.test.ts) tournent sur jsdom, qui
 * n'a pas `execCommand` : le DOM qu'ils lisent est écrit à la main. Ici, c'est
 * le vrai navigateur qui fabrique le DOM, par les vrais boutons de la barre,
 * et c'est la carte enregistrée puis rechargée qu'on relit.
 *
 * Chaque cas a été livré cassé : un espace emporté avec le mot sélectionné,
 * une italique qui finit avec le gras, une couleur posée sur une autre, un
 * gras sur deux lignes, une étoile tapée au clavier.
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
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();

const T = Date.now();
const OWNER = sql("select id from User order by createdAt limit 1;");
const DECK = `forme${T}`;

/*
 * Chaque cas : le texte tapé, puis les gestes — [début, fin, outil] — et ce
 * que l'éditeur rouvert doit montrer : son texte, et des éléments attendus.
 */
const CAS = [
  {
    nom: "un espace sélectionné avec le mot",
    texte: "un mot ici",
    gestes: [[3, 7, "Gras (Ctrl+B)"]],
    attendu: { texte: "un mot ici", el: [["strong, b", "mot"]] },
  },
  {
    nom: "une italique qui finit avec le gras",
    texte: "tout gras fin",
    gestes: [[0, 9, "Gras (Ctrl+B)"], [5, 9, "Italique (Ctrl+I)"]],
    attendu: { texte: "tout gras fin", el: [["strong, b", "tout gras"], ["em, i", "gras"]] },
  },
  {
    nom: "un gras qui finit avec l'italique",
    texte: "tout penché fin",
    gestes: [[0, 11, "Italique (Ctrl+I)"], [5, 11, "Gras (Ctrl+B)"]],
    attendu: { texte: "tout penché fin", el: [["strong, b", "penché"]] },
  },
  {
    nom: "une couleur posée sur une autre",
    texte: "rouge vert bleu",
    gestes: [[0, 15, "Couleur", "Rose"], [6, 10, "Couleur", "Bleu"]],
    attendu: { texte: "rouge vert bleu", el: [[".text-c-blue", "vert"], [".text-c-rose", "rouge"]] },
  },
  {
    nom: "une couleur retirée au milieu d'un texte coloré",
    texte: "rose nu rose",
    gestes: [[0, 12, "Couleur", "Rose"], [5, 7, "Couleur", "Retirer la couleur"]],
    attendu: { texte: "rose nu rose", el: [[".text-c-rose", "rose"]], sans: [".text-c-rose", "nu"] },
  },
  {
    nom: "des étoiles et des accolades tapées",
    texte: "5*3*2 et {c:rose}",
    gestes: [],
    attendu: { texte: "5*3*2 et {c:rose}", el: [] },
  },
];

sql(
  `insert into Deck (id, ownerId, title, updatedAt) values ('${DECK}', '${OWNER}', 'Mise en forme ${T}', ${T});` +
    CAS.map(
      (_c, i) =>
        `insert into Card (id, deckId, term, definition, position, updatedAt) values ('${DECK}c${i}', '${DECK}', '', 'd', ${i}, ${T});`,
    ).join(""),
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/decks/${DECK}`, { waitUntil: "networkidle" });

/** Sélectionne les caractères [debut, fin[ du champ, à travers ses balises. */
async function choisir(label, debut, fin) {
  await page.evaluate(
    ({ label, debut, fin }) => {
      const root = document.querySelector(`[aria-label="${label}"]`);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let vu = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const l = n.textContent.length;
        if (debut >= vu && debut <= vu + l && !range.__debut) {
          range.setStart(n, debut - vu);
          range.__debut = true;
        }
        if (fin >= vu && fin <= vu + l) {
          range.setEnd(n, fin - vu);
          break;
        }
        vu += l;
      }
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { label, debut, fin },
  );
}

const visible = (nom) => page.getByRole("button", { name: nom, exact: true }).filter({ visible: true });

for (const [i, cas] of CAS.entries()) {
  const label = `Terme de la carte ${i + 1}`;
  const champ = page.locator(`[aria-label="${label}"]`);
  await champ.click();
  await champ.pressSequentially(cas.texte);
  for (const [debut, fin, outil, teinte] of cas.gestes) {
    await choisir(label, debut, fin);
    await visible(outil).click();
    if (teinte) await visible(teinte).click();
  }
  // Sortir du champ enregistre la carte.
  await page.locator("h1").first().click();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);

await page.reload({ waitUntil: "networkidle" });
for (const [i, cas] of CAS.entries()) {
  const stocke = sql(`select term from Card where id='${DECK}c${i}';`);
  const rouvert = await page.evaluate((label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    return { texte: el.innerText.trim(), html: el.innerHTML };
  }, `Terme de la carte ${i + 1}`);

  const ok = rouvert.texte === cas.attendu.texte;
  check(ok, `${cas.nom} — aucun marqueur à la réouverture`, `${JSON.stringify(rouvert.texte)} (stocké ${JSON.stringify(stocke)})`);
  for (const [sel, texte] of cas.attendu.el) {
    const trouve = await page.evaluate(
      ({ label, sel, texte }) =>
        [...document.querySelector(`[aria-label="${label}"]`).querySelectorAll(sel)].some(
          (e) => e.textContent.trim() === texte,
        ),
      { label: `Terme de la carte ${i + 1}`, sel, texte },
    );
    check(trouve, `   « ${texte} » est toujours en ${sel}`, rouvert.html);
  }
  if (cas.attendu.sans) {
    const [sel, texte] = cas.attendu.sans;
    const trouve = await page.evaluate(
      ({ label, sel, texte }) =>
        [...document.querySelector(`[aria-label="${label}"]`).querySelectorAll(sel)].some((e) =>
          e.textContent.includes(texte),
        ),
      { label: `Terme de la carte ${i + 1}`, sel, texte },
    );
    check(!trouve, `   « ${texte} » n'est plus en ${sel}`, rouvert.html);
  }
}

// La révision relit le même balisage par l'autre rendu (RichText).
const rendu = await page.request.get(`${BASE}/decks/${DECK}/study`);
check(rendu.ok(), "la page de révision s'ouvre", String(rendu.status()));

check(erreurs.length === 0, "aucune erreur de page", erreurs.join(" | "));
sql(`delete from Deck where id='${DECK}';`);
await browser.close();
console.log(ko === 0 ? "\nTout est bon." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
