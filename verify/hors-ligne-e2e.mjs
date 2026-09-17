/*
 * Réviser sans le serveur — et que rien ne se perde au retour.
 *
 * On épingle un paquet et un dossier pendant que le serveur répond, puis on
 * coupe le réseau **pour de vrai** (`context.setOffline`, qui seul émet les
 * événements `offline` / `online`) et l'on vérifie :
 *
 *  - que le paquet hérité d'un dossier se dit hérité, et mène au dossier ;
 *  - qu'une navigation complète hors ligne ouvre la page hors ligne, avec la
 *    révision demandée, images comprises ;
 *  - qu'un lien de l'app, touché une fois le réseau coupé, y mène aussi ;
 *  - que les réponses données hors ligne survivent à un rechargement en pleine
 *    panne, et modifient déjà ce qui est « à réviser » ;
 *  - qu'au retour du réseau elles partent seules, **une fois**, datées de
 *    l'heure où elles ont été données ;
 *  - que retirer une épingle libère la place sans attendre le serveur, et que
 *    la déconnexion vide l'appareil.
 *
 * Les données d'essai sont créées dans la copie de base (`verif.db`), avec un
 * nom horodaté, et retirées à la fin.
 */
import { chromium } from "playwright";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const { token, userId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail !== "" ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

// --- Données d'essai -----------------------------------------------------------

const db = new DatabaseSync("verif.db");
const TS = Date.now();
const id = (p) => `hl${p}${TS.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const IMAGE = `${randomUUID()}.png`;
copyFileSync("photo.png", `uploads/${IMAGE}`);

const F = id("f");
const S = id("s");
const D1 = id("d");
const D2 = id("d");
const D3 = id("d");
const NOM_F = `HL Biologie ${TS}`;
const NOM_S = `HL Cellule ${TS}`;

const maintenant = Date.now();
const insDossier = db.prepare(
  `INSERT INTO "Folder" (id, ownerId, parentId, kind, name, color, createdAt, updatedAt) VALUES (?, ?, ?, 'deck', ?, 'emerald', ?, ?)`,
);
insDossier.run(F, userId, null, NOM_F, maintenant, maintenant);
insDossier.run(S, userId, F, NOM_S, maintenant, maintenant);

const insPaquet = db.prepare(
  `INSERT INTO "Deck" (id, ownerId, folderId, title, description, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, '', 'blue', ?, ?)`,
);
insPaquet.run(D1, userId, S, `HL Mitochondrie ${TS}`, maintenant, maintenant);
insPaquet.run(D2, userId, null, `HL Géographie ${TS}`, maintenant, maintenant);
insPaquet.run(D3, userId, F, `HL Enzymes ${TS}`, maintenant, maintenant);

const insCarte = db.prepare(
  `INSERT INTO "Card" (id, deckId, term, definition, imagePath, searchText, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
);
const cartes = {};
function carte(deck, term, image = null) {
  const cid = id("c");
  insCarte.run(cid, deck, term, `Définition de ${term}`, image, Object.keys(cartes).length, maintenant, maintenant);
  cartes[term] = cid;
  return cid;
}
carte(D1, "Crête mitochondriale", IMAGE);
carte(D1, "Matrice");
carte(D1, "ATP synthase");
carte(D2, "Capitale du Pérou");
carte(D2, "Fleuve de Lima");
carte(D3, "Site actif");

const reponsesEnBase = (cid) =>
  db.prepare(`SELECT count(*) n FROM "ReviewAnswer" WHERE cardId = ?`).get(cid).n;
const progression = (cid) =>
  db.prepare(`SELECT status, streak, correctCount, missCount, lastSeenAt, dueAt FROM "CardProgress" WHERE cardId = ? AND userId = ?`).get(cid, userId);

// --- Navigateur ----------------------------------------------------------------

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
if (process.env.TRACE) {
  page.on("response", async (r) => {
    if (!r.url().includes("/api/revision")) return;
    console.log("   ⇢", r.status(), r.request().postData()?.slice(0, 300), "⇠", (await r.text().catch(() => "")).slice(0, 200));
  });
  page.on("console", (m) => console.log("   console", m.type(), m.text().slice(0, 200)));
}
page.on("console", (m) => {
  if (m.type() === "error") erreurs.push(`console: ${m.text().slice(0, 200)}`);
});

/** Lecture directe d'IndexedDB, sans rien ajouter à l'app pour se laisser observer. */
const idb = (magasin) =>
  page.evaluate(
    (m) =>
      new Promise((resolve) => {
        const r = indexedDB.open("fiches-hors-ligne");
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(m)) return resolve([]);
          const g = db.transaction(m).objectStore(m).getAll();
          g.onsuccess = () => resolve(g.result);
        };
        r.onerror = () => resolve([]);
      }),
    magasin,
  );
/**
 * Attente par relecture. `waitForFunction` sur une promesse a conclu « vrai »
 * avant que la file ne soit vide : la réponse est arrivée en base juste après
 * le contrôle, et la sonde accusait l'application d'avoir perdu deux réponses.
 */
async function attendre(lire, ok, ms = 20000) {
  const fin = Date.now() + ms;
  let valeur;
  while (Date.now() < fin) {
    valeur = await lire();
    if (ok(valeur)) return valeur;
    await page.waitForTimeout(300);
  }
  return valeur;
}
const cacheCles = (nom) =>
  page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname), nom);
const puce = () => page.locator('[data-testid="hors-ligne"]');
async function attendreEtat(etat, ms = 20000) {
  await page.waitForFunction(
    (e) => document.querySelector('[data-testid="hors-ligne"]')?.getAttribute("data-etat") === e,
    etat,
    { timeout: ms },
  );
}

try {
  // --- 0. Le worker prend la main -------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "networkidle" });
  }
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), "le service worker contrôle la page");

  // --- 1. Épingler un paquet --------------------------------------------------------
  await page.goto(`${BASE}/decks/${D2}`, { waitUntil: "networkidle" });
  await attendreEtat("absent");
  check((await puce().textContent())?.includes("Garder hors ligne"), "la puce propose de garder le paquet", await puce().textContent());
  await puce().click();
  await attendreEtat("disponible");
  check((await puce().getAttribute("aria-pressed")) === "true", "puce enfoncée une fois le paquet descendu");
  const apres1 = await idb("paquets");
  check(apres1.some((p) => p.id === D2 && p.cartes.length === 2), "le paquet et ses deux cartes sont sur l'appareil");

  // --- 2. Épingler un dossier : ses sous-dossiers et ses paquets suivent ----------
  await page.goto(`${BASE}/folders/${F}`, { waitUntil: "networkidle" });
  await attendreEtat("absent");
  await puce().click();
  await attendreEtat("disponible");
  const paquets2 = (await idb("paquets")).map((p) => p.id);
  check(
    [D1, D2, D3].every((d) => paquets2.includes(d)),
    "le dossier fait descendre le paquet du sous-dossier et le sien",
    paquets2.length,
  );

  await page.goto(`${BASE}/decks/${D1}`, { waitUntil: "networkidle" });
  await attendreEtat("herite");
  const texteHerite = await puce().textContent();
  check(texteHerite?.includes(NOM_F), "un paquet du sous-dossier se dit gardé avec le dossier", texteHerite);
  check(
    (await puce().getAttribute("href")) === `/folders/${F}`,
    "et sa puce mène au dossier qui le garde, là où on le retire",
  );

  // Images et coquille
  await page.waitForFunction(
    async (img) => (await (await caches.open("fiches-fichiers")).keys()).some((r) => r.url.endsWith(img)),
    IMAGE,
    { timeout: 15000 },
  );
  check((await cacheCles("fiches-fichiers")).some((u) => u.endsWith(IMAGE)), "l'image d'une carte est en cache");
  const coquille = await cacheCles("fiches-coquille");
  check(
    coquille.includes("/offline") && coquille.some((u) => u.endsWith(".js")) && coquille.some((u) => u.endsWith(".css")),
    "la page hors ligne est en cache avec ses scripts et sa feuille de style",
    `${coquille.length} entrées`,
  );

  // --- 3. La grille le montre ---------------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="pastille-hors-ligne"]');
  const lienD2 = page.locator(`a[href="/decks/${D2}"]`);
  check((await lienD2.locator('[data-testid="pastille-hors-ligne"]').count()) === 1, "pastille sur le paquet gardé");
  const lienF = page.locator(`a[href="/folders/${F}"]`);
  check((await lienF.locator('[data-testid="pastille-hors-ligne"]').count()) === 1, "pastille sur le dossier gardé");

  // --- 4. Révision en ligne : la réponse passe par la file et arrive ----------------
  await page.goto(`${BASE}/decks/${D3}/study`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "À revoir" }).click();
  await page.waitForTimeout(2000);
  check(reponsesEnBase(cartes["Site actif"]) === 1, "en ligne, la réponse arrive au serveur par la même file");
  check((await idb("envois")).length === 0, "et quitte l'appareil une fois confirmée");

  // --- 5. Coupure : un lien de l'app mène à la page hors ligne -----------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await ctx.setOffline(true);
  await page.locator(`a[href="/decks/${D2}"]`).first().click();
  await page.waitForURL(/\/offline\?de=/, { timeout: 15000 });
  await page.waitForSelector('[data-testid="carte-hors-ligne"]', { timeout: 15000 });
  check(
    (await page.locator('[data-testid="carte-hors-ligne"]').count()) === 2,
    "hors ligne, toucher un paquet de la grille ouvre sa page hors ligne",
    page.url().replace(BASE, ""),
  );

  // --- 6. Révision hors ligne, par une navigation complète ---------------------------
  await page.goto(`${BASE}/decks/${D1}/study`);
  await page.waitForURL(/\/offline\?de=%2Fdecks%2F/, { timeout: 15000 });
  await page.getByRole("button", { name: "Je savais" }).waitFor({ timeout: 15000 });
  const position = await page.locator("span.tabular-nums").filter({ hasText: "/" }).first().textContent();
  check(position?.trim() === "1 / 3", "la révision du paquet s'ouvre sans serveur", position);

  const debut = Date.now();
  await page.getByRole("button", { name: "Je savais" }).click();
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "Je savais" }).click();
  await page.waitForTimeout(800);
  const envois6 = await idb("envois");
  check(envois6.filter((e) => e.genre === "reponse").length === 2, "deux réponses posées sur l'appareil", envois6.length);

  await page.reload();
  await page.getByRole("button", { name: "Je savais" }).waitFor({ timeout: 15000 });
  const position2 = await page.locator("span.tabular-nums").filter({ hasText: "/" }).first().textContent();
  check(position2?.trim() === "1 / 1", "rechargée en pleine panne, il ne reste que la carte pas encore sue", position2);

  // Image de la carte, depuis le cache
  await page.goto(`${BASE}/decks/${D1}`);
  await page.waitForSelector('[data-testid="carte-hors-ligne"] img', { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="carte-hors-ligne"] img')].every((i) => i.complete));
  const largeur = await page.locator('[data-testid="carte-hors-ligne"] img').first().evaluate((i) => i.naturalWidth);
  check(largeur > 0, "l'image de la carte s'affiche hors ligne", `${largeur} px`);
  check(
    (await page.locator('[data-testid="bandeau-en-attente"]').textContent())?.includes("2 réponses"),
    "la page dit que deux réponses attendent le réseau",
  );

  // Accueil et page qui a besoin du serveur
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('[data-testid="page-indisponible"]', { timeout: 15000 });
  const titres = await page.locator('[data-testid="paquet-hors-ligne"]').allTextContents();
  check(
    (await page.getByText(NOM_F).count()) === 1 && titres.some((t) => t.includes("HL Géographie")),
    "une page non gardée renvoie à ce qui est sur l'appareil : le dossier et le paquet épinglés",
  );
  check(!titres.some((t) => t.includes("HL Mitochondrie")), "sans répéter les paquets déjà montrés par leur dossier");

  // --- 7. Retour du réseau : les réponses partent seules, une fois ----------------------
  check(reponsesEnBase(cartes["Crête mitochondriale"]) === 0, "rien n'est parti pendant la panne");
  await ctx.setOffline(false);
  const file7 = await attendre(() => idb("envois"), (e) => e.length === 0);
  check(file7.length === 0, "au retour du réseau, la file se vide d'elle-même", file7.length);
  await attendre(async () => reponsesEnBase(cartes["Matrice"]), (n) => n > 0, 5000);

  const p1 = progression(cartes["Crête mitochondriale"]);
  const p2 = progression(cartes["Matrice"]);
  check(
    reponsesEnBase(cartes["Crête mitochondriale"]) === 1 && reponsesEnBase(cartes["Matrice"]) === 1,
    "chaque réponse est enregistrée une fois",
  );
  check(p1?.status === "known" && p1?.streak === 1, "la carte est sue côté serveur", JSON.stringify(p1));
  check(
    p1 && p1.lastSeenAt >= debut && p1.lastSeenAt < debut + 3000 && p2.lastSeenAt > p1.lastSeenAt,
    "datée de l'heure où l'on a répondu, pas de celle où le serveur l'a reçue",
    p1 ? `${p1.lastSeenAt - debut} ms après le début` : "",
  );

  // --- 8. Rejouer un lot ne compte pas double ; une réponse ancienne ne replanifie pas
  const rejeu = await page.evaluate(
    async ({ lot }) => {
      const envoyer = () =>
        fetch("/api/revision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lot) });
      const a = await envoyer();
      const b = await envoyer();
      return [a.status, b.status];
    },
    {
      lot: {
        reponses: [{ id: randomUUID(), cardId: cartes["ATP synthase"], knew: true, answeredAt: Date.now() - 1000 }],
        sessions: [],
      },
    },
  );
  const p3 = progression(cartes["ATP synthase"]);
  check(
    rejeu.join() === "200,200" && p3?.correctCount === 1 && reponsesEnBase(cartes["ATP synthase"]) === 1,
    "un lot envoyé deux fois n'est compté qu'une fois",
    JSON.stringify(p3),
  );

  const avant = progression(cartes["Crête mitochondriale"]);
  await page.evaluate(
    async (lot) =>
      fetch("/api/revision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lot) }),
    { reponses: [{ id: randomUUID(), cardId: cartes["Crête mitochondriale"], knew: false, answeredAt: avant.lastSeenAt - 60_000 }], sessions: [] },
  );
  const apres = progression(cartes["Crête mitochondriale"]);
  check(
    apres.missCount === avant.missCount + 1 && apres.dueAt === avant.dueAt && apres.streak === avant.streak,
    "une réponse plus ancienne que la dernière compte, sans replanifier la carte",
    `missCount ${avant.missCount}→${apres.missCount}, dueAt ${avant.dueAt === apres.dueAt ? "inchangée" : "changée"}`,
  );

  // --- 9. Ce qui change au serveur descend à la synchronisation suivante --------------
  db.prepare(
    `INSERT INTO "Card" (id, deckId, term, definition, imagePath, searchText, position, createdAt, updatedAt) VALUES (?, ?, 'Plus haut sommet', 'Huascarán', NULL, '', 9, ?, ?)`,
  ).run(id("c"), D2, Date.now(), Date.now());
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await ctx.setOffline(true);
  await ctx.setOffline(false);
  const d2 = await attendre(async () => (await idb("paquets")).find((p) => p.id === D2), (p) => p?.cartes.length === 3);
  check(d2?.cartes.length === 3, "une carte ajoutée au serveur descend au retour du réseau", d2?.cartes.length);


  // --- 10. Retirer libère la place tout de suite ------------------------------------
  await page.goto(`${BASE}/folders/${F}`, { waitUntil: "networkidle" });
  await attendreEtat("disponible");
  await ctx.setOffline(true); // même sans réseau
  await puce().click();
  await page.waitForTimeout(800);
  const restants = (await idb("paquets")).map((p) => p.id);
  check(
    !restants.includes(D1) && !restants.includes(D3) && restants.includes(D2),
    "retirer le dossier, même hors ligne, retire ses paquets et garde le paquet épinglé à part",
    restants.length,
  );
  check(
    !(await cacheCles("fiches-fichiers")).some((u) => u.endsWith(IMAGE)),
    "et libère l'image qui ne sert plus",
  );
  await ctx.setOffline(false);

  // --- 11. La déconnexion vide l'appareil ------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login/);
  const vide = { epingles: (await idb("epingles")).length, paquets: (await idb("paquets")).length };
  check(vide.epingles === 0 && vide.paquets === 0, "se déconnecter retire ce qui était gardé", JSON.stringify(vide));
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);

  const bruit = erreurs.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch RSC payload/.test(e));
  check(bruit.length === 0, "aucune erreur de page", bruit.join(" | "));
  if (erreurs.length > bruit.length) console.log(`   (${erreurs.length - bruit.length} erreurs réseau attendues pendant la panne)`);
} finally {
  await browser.close();
  // Nettoyage : ce script ne laisse rien derrière lui.
  for (const d of [D1, D2, D3]) {
    db.prepare(`DELETE FROM "Deck" WHERE id = ?`).run(d);
  }
  db.prepare(`DELETE FROM "Folder" WHERE id IN (?, ?)`).run(S, F);
  db.close();
  rmSync(`uploads/${IMAGE}`, { force: true });
}

console.log(echecs === 0 ? "\nTout est bon." : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
