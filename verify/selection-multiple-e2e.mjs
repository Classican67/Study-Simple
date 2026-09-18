/*
 * Sélection de plusieurs paquets ou notes, pour les manipuler d'un geste.
 *
 * - « Sélectionner » ouvre le mode ; toucher une carte la coche au lieu de
 *   l'ouvrir ; la barre compte ce qui est coché.
 * - Déplacer, supprimer, marquer « maîtrisée » portent sur **toute** la
 *   sélection, et sur elle seule — vérifié en base, pas à l'écran.
 * - Ctrl/⌘-clic entre dans la sélection, Maj-clic coche une plage, Échap sort.
 * - L'appui long au doigt propose « Sélectionner » dans le menu d'une note.
 * - Glisser la poignée d'un élément coché emporte toute la sélection.
 * - Sur téléphone, la barre ne passe pas sous la barre de navigation, et
 *   chacun de ses boutons est bien le premier élément sous son centre.
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
const OWNER = sql("select id from User order by createdAt limit 1;");
const now = Date.now();

// Données d'essai horodatées, créées directement dans la base du bac à sable.
function deck(nom, folder = null) {
  const id = `seldeck${T}${nom.replace(/\W/g, "")}`;
  sql(
    `insert into Deck (id, ownerId, folderId, title, updatedAt) values ('${id}', '${OWNER}', ${folder ? `'${folder}'` : "null"}, '${nom}', ${now});` +
      `insert into Card (id, deckId, term, definition, updatedAt) values ('${id}c', '${id}', 'terme', 'déf', ${now});`,
  );
  return id;
}
function note(nom, folder = null, age = 0) {
  const id = `selnote${T}${nom.replace(/\W/g, "")}`;
  sql(
    `insert into Note (id, ownerId, folderId, title, updatedAt) values ('${id}', '${OWNER}', ${folder ? `'${folder}'` : "null"}, '${nom}', ${now - age});`,
  );
  return id;
}
function dossier(nom, kind) {
  const id = `seldir${T}${nom.replace(/\W/g, "")}`;
  sql(
    `insert into Folder (id, ownerId, name, kind, updatedAt) values ('${id}', '${OWNER}', '${nom}', '${kind}', ${now});`,
  );
  return id;
}

const browser = await chromium.launch();
const errors = [];

async function contexte(options) {
  const ctx = await browser.newContext(options);
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  return page;
}

const barre = (page) => page.getByRole("toolbar", { name: "Sélection" });
const compte = async (page) => (await barre(page).locator("p[aria-live]").textContent())?.trim();
const caseDe = (page, nom) => page.getByRole("checkbox", { name: `Sélectionner « ${nom} »` });

// --- Paquets, à la souris ----------------------------------------------------
section("paquets — déplacer et supprimer une sélection");
const DDIR = `Sel dossier ${T}`;
const dDir = dossier(DDIR, "deck");
const A = `Sel A ${T}`, B = `Sel B ${T}`, C = `Sel C ${T}`;
const [a, b, c] = [deck(A), deck(B), deck(C)];

let page = await contexte({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
check(!(await barre(page).isVisible()), "pas de barre hors du mode sélection");
await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
check(await barre(page).isVisible(), "« Sélectionner » ouvre la barre");
check((await compte(page)) === "Aucun paquet", "rien n'est coché d'avance", await compte(page));

await page.locator(`a[href="/decks/${a}"]`).click();
await page.locator(`a[href="/decks/${b}"]`).click();
await page.waitForTimeout(200);
check(new URL(page.url()).pathname === "/", "toucher une carte ne l'ouvre pas", page.url());
check((await caseDe(page, A).getAttribute("aria-checked")) === "true", "la carte touchée est cochée");
check((await compte(page)) === "2 paquets", "la barre compte la sélection", await compte(page));
await page.locator(`a[href="/decks/${b}"]`).click();
check((await compte(page)) === "1 paquet", "toucher à nouveau décoche", await compte(page));
await caseDe(page, B).click();
check((await compte(page)) === "2 paquets", "la case elle-même coche aussi", await compte(page));

await barre(page).getByRole("button", { name: "Déplacer" }).click();
const dlg = page.getByRole("dialog");
check((await dlg.textContent()).includes("Déplacer 2 paquets"), "la boîte annonce le nombre");
await dlg.locator("select").selectOption(dDir);
await dlg.getByRole("button", { name: "Déplacer" }).click();
await dlg.waitFor({ state: "detached" });
await page.waitForTimeout(600);
check(
  sql(`select count(*) from Deck where id in ('${a}','${b}') and folderId='${dDir}';`) === "2",
  "les deux paquets sont rangés dans le dossier",
);
check(sql(`select folderId is null from Deck where id='${c}';`) === "1", "le paquet non coché ne bouge pas");
check(!(await barre(page).isVisible()), "la sélection se referme après l'action");
check((await page.locator(`a[href="/decks/${a}"]`).count()) === 0, "la liste est à jour sans recharger");

// Ctrl-clic, Maj-clic, Échap.
section("paquets — Ctrl-clic, Maj-clic, Échap");
await page.locator(`a[href="/decks/${c}"]`).click({ modifiers: ["ControlOrMeta"] });
await page.waitForTimeout(200);
check(page.context().pages().length === 1, "Ctrl-clic n'ouvre pas d'onglet");
check((await compte(page)) === "1 paquet", "Ctrl-clic entre dans la sélection avec la carte", await compte(page));
const cartes = page.locator('[role="checkbox"][aria-label^="Sélectionner"]');
const n = await cartes.count();
if (n >= 3) {
  // Plage : de la carte cochée à la dernière de la liste.
  const indexC = await cartes.evaluateAll((els, nom) => els.findIndex((e) => e.getAttribute("aria-label").includes(nom)), C);
  const cible = indexC === n - 1 ? 0 : n - 1;
  await cartes.nth(cible).click({ modifiers: ["Shift"] });
  const attendu = Math.abs(cible - indexC) + 1;
  check((await compte(page)) === `${attendu} paquets`, "Maj-clic coche toute la plage", `${await compte(page)} / ${attendu}`);
}
// La plage a pu tout cocher : on repart d'une sélection partielle.
if (await page.getByRole("button", { name: "Tout désélectionner" }).isVisible()) {
  check(
    (await page.getByRole("button", { name: "Tout désélectionner" }).getAttribute("aria-pressed")) === "true",
    "tout coché à la main : le bouton propose de tout décocher",
  );
  await caseDe(page, C).click();
}
await page.getByRole("button", { name: "Tout sélectionner" }).click();
check((await compte(page)) === `${n} paquets`, "« Tout sélectionner »", await compte(page));
await page.getByRole("button", { name: "Tout désélectionner" }).click();
check((await compte(page)) === "Aucun paquet", "puis « Tout désélectionner »", await compte(page));
await page.keyboard.press("Escape");
check(!(await barre(page).isVisible()), "Échap quitte la sélection");
await page.locator(`a[href="/decks/${c}"]`).click();
await page.waitForURL(`**/decks/${c}`);
check(true, "hors sélection, une carte s'ouvre comme avant");

// Suppression depuis le dossier.
await page.goto(`${BASE}/folders/${dDir}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
await page.getByRole("button", { name: "Tout sélectionner" }).click();
check((await compte(page)) === "2 paquets", "« Tout » dans le dossier coche ses deux paquets", await compte(page));
await barre(page).getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").waitFor({ state: "detached" });
await page.waitForTimeout(600);
check(sql(`select count(*) from Deck where id in ('${a}','${b}');`) === "0", "les paquets sont supprimés");
check(sql(`select count(*) from Card where deckId in ('${a}','${b}');`) === "0", "leurs cartes avec eux");
check(sql(`select count(*) from Deck where id='${c}';`) === "1", "le paquet hors sélection est intact");
await page.close();

// --- Notes, au doigt sur téléphone -------------------------------------------
section("notes — téléphone, appui long, maîtrisée, ranger");
const NDIR = `Sel notes ${T}`;
const nDir = dossier(NDIR, "note");
const N1 = `Sel note 1 ${T}`, N2 = `Sel note 2 ${T}`, N3 = `Sel note 3 ${T}`;
// Datées dans le passé : marquer « maîtrisée » ne doit pas les faire remonter.
const [n1, n2, n3] = [note(N1, null, 3e8), note(N2, null, 3e8), note(N3, null, 3e8)];
const avant = sql(`select updatedAt from Note where id='${n1}';`);

page = await contexte({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });

// Appui long, comme dans menus-e2e.mjs : iPadOS n'émet pas `contextmenu`.
await page.evaluate(async (sel) => {
  const el = document.querySelector(sel);
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 3, y = r.top + r.height / 2;
  const fire = (type) =>
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true,
      buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y,
    }));
  fire("pointerdown");
  await new Promise((r) => setTimeout(r, 650));
  fire("pointerup");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}, `a[href="/notes/${n1}"]`);
await page.getByRole("menu").waitFor();
await page.getByRole("menuitem", { name: "Sélectionner" }).click();
check((await compte(page)) === "1 note", "« Sélectionner » du menu coche la note", await compte(page));
await page.locator(`a[href="/notes/${n2}"]`).tap();
await page.waitForTimeout(200);
check(new URL(page.url()).pathname === "/notes", "un toucher coche au lieu d'ouvrir", page.url());
check((await compte(page)) === "2 notes", "deux notes cochées", await compte(page));

// La barre au-dessus de la navigation, et rien ne recouvre ses boutons.
const geo = await page.evaluate(() => {
  const bar = document.querySelector('[role="toolbar"][aria-label="Sélection"]').getBoundingClientRect();
  // Il y a deux navigations principales : le bandeau du haut et la barre du
  // bas. C'est celle du bas, fixe, que la barre de sélection ne doit pas couvrir.
  const nav = [...document.querySelectorAll('nav[aria-label="Navigation principale"]')]
    .map((n) => n.getBoundingClientRect())
    .find((r) => r.height > 0 && r.top > innerHeight / 2);
  const boutons = [...document.querySelectorAll('[role="toolbar"][aria-label="Sélection"] button')].map((b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { nom: b.getAttribute("aria-label"), h: r.height, w: r.width, dessus: b.contains(top) };
  });
  return { bar: { bottom: bar.bottom, left: bar.left, right: bar.right }, navTop: nav?.top ?? null, boutons, largeur: innerWidth };
});
check(geo.navTop !== null && geo.bar.bottom <= geo.navTop, "la barre ne passe pas sous la navigation", JSON.stringify(geo));
check(geo.bar.left >= 0 && geo.bar.right <= geo.largeur, "la barre tient dans la largeur", JSON.stringify(geo.bar));
for (const bt of geo.boutons) {
  check(bt.dessus, `« ${bt.nom} » n'est recouvert par rien`);
  check(bt.h >= 44 && bt.w >= 44, `« ${bt.nom} » fait au moins 44 px`, `${bt.w}×${bt.h}`);
}
await page.screenshot({ path: "shots/selection-telephone.png" });

await barre(page).getByRole("button", { name: "Maîtrisée" }).tap();
await page.waitForTimeout(700);
check(
  sql(`select count(*) from Note where id in ('${n1}','${n2}') and mastered=1;`) === "2",
  "« Maîtrisée » marque les deux notes",
);
check(sql(`select mastered from Note where id='${n3}';`) === "0", "et pas la troisième");
check(sql(`select updatedAt from Note where id='${n1}';`) === avant, "sans toucher à la date, donc au tri");
check((await compte(page)) === "2 notes", "la sélection reste pour l'action suivante", await compte(page));
check(
  (await barre(page).getByRole("button", { name: "Démarquer" }).count()) === 1,
  "le bouton propose maintenant de démarquer",
);

await barre(page).getByRole("button", { name: "Ranger" }).tap();
await page.getByRole("dialog").locator("select").selectOption(nDir);
await page.getByRole("dialog").getByRole("button", { name: "Déplacer" }).tap();
await page.getByRole("dialog").waitFor({ state: "detached" });
await page.waitForTimeout(600);
check(
  sql(`select count(*) from Note where id in ('${n1}','${n2}') and folderId='${nDir}';`) === "2",
  "les deux notes sont rangées",
);
check(sql(`select folderId is null from Note where id='${n3}';`) === "1", "la troisième reste à la racine");
await page.close();

// --- Glisser une sélection ----------------------------------------------------
section("notes — glisser la sélection vers un dossier");
page = await contexte({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const N4 = `Sel note 4 ${T}`;
const n4 = note(N4);
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
await caseDe(page, N3).click();
await caseDe(page, N4).click();
check((await compte(page)) === "2 notes", "deux notes cochées pour le glisser", await compte(page));
// Saisie dans la sélection, la poignée ne porte plus le nom de la note mais
// ce qu'elle emporte.
const poignee = page.locator(`li:has(a[href="/notes/${n4}"]) button[aria-label^="Déplacer"]`);
check(
  (await poignee.getAttribute("aria-label")).startsWith("Déplacer 2 notes"),
  "la poignée d'une note cochée annonce toute la sélection",
  await poignee.getAttribute("aria-label"),
);
const cible = page.locator(`[data-drop-folder="${nDir}"]`);
const p = await poignee.boundingBox();
const q = await cible.boundingBox();
await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
await page.mouse.down();
await page.mouse.move(q.x + 20, q.y + 20, { steps: 8 });
const fantome = await page.locator("span.pointer-events-none.fixed").textContent();
check(fantome === "2 notes", "l'étiquette annonce ce qu'on emporte", fantome);
await page.mouse.up();
await page.waitForTimeout(800);
check(
  sql(`select count(*) from Note where id in ('${n3}','${n4}') and folderId='${nDir}';`) === "2",
  "les deux notes cochées arrivent dans le dossier",
);

// Suppression dans le dossier, puis ménage.
await page.goto(`${BASE}/notes?folder=${nDir}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
await page.getByRole("button", { name: "Tout sélectionner" }).click();
check((await compte(page)) === "4 notes", "« Tout » coche les quatre notes du dossier", await compte(page));
await page.screenshot({ path: "shots/selection-desktop.png" });
await barre(page).getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").waitFor({ state: "detached" });
await page.waitForTimeout(600);
check(sql(`select count(*) from Note where id like 'selnote${T}%';`) === "0", "les notes sont supprimées");

// --- Regard : clair et sombre, téléphone et desktop ---------------------------
// `audit.mjs` ne voit pas la barre : elle n'existe qu'une fois la sélection
// ouverte. Elle est donc mesurée ici, texte par texte.
section("regard — contraste de la barre, en clair et en sombre");
const N5 = `Sel regard ${T}`;
note(N5);
const MESURE = `(() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRgb = (color) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bar = document.querySelector('[role="toolbar"][aria-label="Sélection"]');
  const fond = toRgb(getComputedStyle(bar).backgroundColor);
  return [...bar.querySelectorAll("button, p")].map((el) => ({
    nom: el.getAttribute("aria-label") || el.textContent.trim(),
    contraste: ratio(toRgb(getComputedStyle(el).color), fond),
  }));
})()`;
for (const [appareil, viewport, extra] of [
  ["téléphone", { width: 393, height: 852 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 }],
  ["desktop", { width: 1280, height: 900 }, { deviceScaleFactor: 2 }],
]) {
  for (const theme of ["light", "dark"]) {
    const pg = await contexte({ viewport, colorScheme: theme, ...extra });
    await pg.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await pg.getByRole("button", { name: "Sélectionner", exact: true }).click();
    await caseDe(pg, N5).click();
    for (const m of await pg.evaluate(MESURE)) {
      check(m.contraste >= 4.5, `${appareil} ${theme} — « ${m.nom} » : contraste`, m.contraste.toFixed(2));
    }
    // La case et l'anneau ont une transition : photographier après.
    await pg.waitForTimeout(400);
    await caseDe(pg, N5).evaluate((el) => el.closest("li").scrollIntoView({ block: "center" }));
    await pg.screenshot({ path: `shots/selection-${appareil === "téléphone" ? "telephone" : "desktop"}-${theme}.png` });
    await pg.close();
  }
}

// Ménage de ce que le scénario a créé.
sql(
  `delete from Deck where id like 'seldeck${T}%'; delete from Note where id like 'selnote${T}%'; delete from Folder where id like 'seldir${T}%';`,
);
check(errors.length === 0, "aucune erreur de page", errors.join(" | "));

await browser.close();
console.log(ko === 0 ? "\nTout est bon." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
