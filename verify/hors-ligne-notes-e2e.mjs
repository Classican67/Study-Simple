/*
 * Consulter et annoter une note sans le serveur.
 *
 * Même principe que `hors-ligne-e2e.mjs` : le réseau est coupé pour de vrai,
 * et l'on vérifie ce qui compte pour la personne, pas ce que le code dit :
 *
 *  - une note gardée s'ouvre hors ligne avec ses traits, et un polycopié
 *    gardé avec un dossier s'y **dessine** (on lit ses pixels) ;
 *  - la copie gardée suit ce que le serveur confirme : sans cela, écrire en
 *    cours puis partir sans réseau dans la minute ouvrait une copie ancienne,
 *    et y écrire aurait écrasé au serveur les traits de la fin du cours ;
 *  - un trait posé hors ligne survit à un rechargement en pleine panne, et
 *    part seul au retour du réseau ;
 *  - hors ligne, on ne propose pas ce qui a besoin du serveur (supprimer,
 *    déplacer, ajouter un bloc) ;
 *  - l'option « Garder hors ligne » du menu d'un dossier de notes fait ce
 *    qu'elle annonce, et se retire de même.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const db = new DatabaseSync("verif.db");

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail !== "" ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

// Une note à polycopié, rangée dans un dossier de notes, prise dans la copie
// de base — on ne l'annote pas, on la lit.
const pdf = db
  .prepare(
    `SELECT n.id, n.folderId, f.name FROM "NoteBlock" b JOIN "Note" n ON n.id = b.noteId JOIN "Folder" f ON f.id = n.folderId WHERE b.content LIKE ? AND f.kind = 'note' LIMIT 1`,
  )
  .get("%.pdf%");
if (!pdf) {
  console.log("❌ aucune note à polycopié rangée dans un dossier de notes dans verif.db");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));

const TITRE = `HL note ${Date.now()}`;
let noteId = null;

const canvas = () => page.locator('[data-testid="drawing-canvas"]').first();
const traits = async () => Number((await canvas().getAttribute("aria-label"))?.match(/(\d+) trait/)?.[1] ?? -1);
async function geste(y) {
  await canvas().evaluate(async (el, yy) => {
    const r = el.getBoundingClientRect();
    const fire = (t, x, p, b) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
          pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * (yy + (Math.round(x * 100) % 2) * 0.003),
        }),
      );
    fire("pointerdown", 0.15, 0.5, 1);
    for (let i = 1; i < 20; i++) {
      fire("pointermove", 0.15 + i * 0.03, 0.45 + Math.sin(i) * 0.1, 1);
      if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", 0.72, 0, 0);
  }, y);
  await page.waitForTimeout(150);
}
async function attendre(lire, ok, ms = 20000) {
  const fin = Date.now() + ms;
  let v;
  while (Date.now() < fin) {
    v = await lire();
    if (ok(v)) return v;
    await page.waitForTimeout(300);
  }
  return v;
}
/** Traits du bloc manuscrit tels que la copie gardée les porte. */
const traitsGardes = (id) =>
  page.evaluate(
    (nid) =>
      new Promise((resolve) => {
        const r = indexedDB.open("fiches-hors-ligne");
        r.onsuccess = () => {
          const tx = r.result.transaction(["notes", "blocs"]);
          const g = tx.objectStore("notes").get(nid);
          g.onsuccess = () => {
            const bloc = g.result?.blocs.find((b) => b.kind === "drawing");
            if (!bloc) return resolve(-1);
            const c = tx.objectStore("blocs").get(bloc.id);
            c.onsuccess = () => resolve(JSON.parse(c.result.content).strokes.length);
          };
        };
      }),
    id,
  );
const traitsEnBase = (id) => {
  const b = db.prepare(`SELECT content FROM "NoteBlock" WHERE noteId = ? AND kind = 'drawing' ORDER BY position LIMIT 1`).get(id);
  return b ? JSON.parse(b.content).strokes.length : -1;
};

try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });

  // --- 1. Une note, deux traits, gardée hors ligne -----------------------------
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+$/);
  noteId = page.url().split("/").pop();
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await canvas().waitFor();
  await page.getByRole("button", { name: "Stylo" }).click();
  await geste(0.1);
  await geste(0.16);
  await attendre(async () => traitsEnBase(noteId), (n) => n === 2);
  check(traitsEnBase(noteId) === 2, "deux traits en base");

  const puce = page.locator('[data-testid="hors-ligne"]');
  await puce.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="hors-ligne"]')?.dataset.etat === "disponible", null, { timeout: 20000 });
  check((await traitsGardes(noteId)) === 2, "la note est gardée avec ses deux traits");

  // --- 2. La copie suit ce que le serveur confirme --------------------------------
  await geste(0.22);
  await attendre(async () => traitsEnBase(noteId), (n) => n === 3);
  const garde2 = await attendre(() => traitsGardes(noteId), (n) => n === 3, 8000);
  check(
    garde2 === 3,
    "un trait confirmé par le serveur entre dans la copie gardée, sans attendre la synchronisation",
    `copie ${garde2}, base ${traitsEnBase(noteId)}`,
  );

  // --- 3. Garder un dossier de notes depuis son menu --------------------------------
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  // Un vrai réseau n'est pas un serveur local : les polycopiés mettent des
  // secondes à descendre. Sans ce ralenti, ils arrivaient toujours avant que
  // la pastille ne paraisse, et la sonde ne voyait jamais la pastille en avance.
  await ctx.route(/\/api\/uploads\//, async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fallback();
  });
  await page.getByRole("button", { name: `Options du dossier « ${pdf.name} »` }).first().click();
  await page.getByRole("menuitem", { name: "Garder hors ligne" }).click();
  await attendre(
    () => page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("fiches-hors-ligne");
      r.onsuccess = () => { const g = r.result.transaction("notes").objectStore("notes").getAllKeys(); g.onsuccess = () => res(g.result); };
    })),
    (cles) => cles.includes(pdf.id),
  );
  const lien = page.locator(`a[href="/notes?folder=${pdf.folderId}"]`).first();
  await lien.locator('[data-testid="pastille-hors-ligne"]').waitFor({ timeout: 10000 });
  check(true, "l'option du menu garde le dossier, et la liste le montre");
  // La pastille promet qu'on peut partir : à l'instant où elle paraît, **tous**
  // les polycopiés du dossier doivent être là. Elle paraissait dès le premier,
  // et le second s'ouvrait hors ligne sur « Document illisible ».
  const attendus = [
    ...new Set(
      db
        .prepare(`SELECT b.content FROM "NoteBlock" b JOIN "Note" n ON n.id = b.noteId WHERE n.folderId = ?`)
        .all(pdf.folderId)
        .flatMap((b) => b.content.match(/[0-9a-f-]{36}\.(?:pdf|jpg|png|webp)/g) ?? []),
    ),
  ];
  const fichiers = await page.evaluate(async () =>
    (await (await caches.open("fiches-fichiers")).keys()).map((r) => r.url),
  );
  const manquants = attendus.filter((nom) => !fichiers.some((u) => u.endsWith(nom)));
  check(
    attendus.length > 0 && manquants.length === 0,
    "quand la pastille paraît, tous les fichiers du dossier sont déjà en cache",
    `${attendus.length - manquants.length}/${attendus.length}`,
  );
  await ctx.unroute(/\/api\/uploads\//);
  const coquille = await attendre(
    () => page.evaluate(async () => (await (await caches.open("fiches-coquille")).keys()).map((r) => new URL(r.url).pathname)),
    (u) => u.includes("/pdf.worker.min.mjs"),
  );
  check(coquille.includes("/pdf.worker.min.mjs"), "le worker de pdf.js est dans la coquille", `${coquille.length} entrées`);

  // --- 4. Hors ligne : la note s'ouvre, on y écrit --------------------------------
  await ctx.setOffline(true);
  await page.goto(`${BASE}/notes/${noteId}`);
  await page.waitForURL(/\/offline\?de=/, { timeout: 15000 });
  await canvas().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  check((await traits()) === 3, "hors ligne, la note s'ouvre avec ses trois traits", await traits());
  check(
    (await page.getByRole("button", { name: /Supprimer le bloc/ }).count()) === 0 &&
      (await page.getByRole("button", { name: "Texte", exact: true }).count()) === 0,
    "ce qui a besoin du serveur n'est pas proposé",
  );

  await page.getByRole("button", { name: "Stylo" }).click();
  await geste(0.28);
  await page.waitForTimeout(1500);
  check((await traits()) === 4, "un quatrième trait, posé sans réseau", await traits());
  check(traitsEnBase(noteId) === 3, "il n'est pas parti");

  await page.reload();
  await canvas().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  check((await traits()) === 4, "rechargée en pleine panne, la note garde le trait non envoyé", await traits());

  // --- 5. Le polycopié s'affiche hors ligne ---------------------------------------
  await page.goto(`${BASE}/notes/${pdf.id}`);
  const pagePdf = page.locator('canvas[aria-label="Page 1 du document importé"]').first();
  // Un worker de pdf.js absent ne lève rien : la page reste simplement sans
  // canevas. On le dit au lieu de s'arrêter sur un délai dépassé.
  const dessinee = await pagePdf.waitFor({ timeout: 20000 }).then(() => true, () => false);
  const encre = !dessinee ? 0 : await attendre(
    () =>
      pagePdf.evaluate((c) => {
        if (!c.width) return 0;
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let sombres = 0;
        for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] < 600) sombres++;
        return sombres;
      }),
    (n) => n > 50,
    15000,
  );
  check(encre > 50, "la première page du PDF est dessinée, sans réseau", `${encre} pixels sombres échantillonnés`);

  await page.goto(`${BASE}/notes?folder=${pdf.folderId}`);
  await page.waitForSelector('[data-testid="note-hors-ligne"]', { timeout: 15000 });
  check(
    (await page.locator(`[data-testid="note-hors-ligne"][href="/notes/${pdf.id}"]`).count()) === 1,
    "le dossier de notes gardé se consulte hors ligne",
  );

  // --- 6. Retour du réseau -----------------------------------------------------------
  await page.goto(`${BASE}/notes/${noteId}`);
  await canvas().waitFor({ timeout: 15000 });
  await ctx.setOffline(false);
  const base6 = await attendre(async () => traitsEnBase(noteId), (n) => n === 4);
  check(base6 === 4, "au retour du réseau, le trait écrit hors ligne arrive au serveur", base6);
  const garde6 = await attendre(() => traitsGardes(noteId), (n) => n === 4, 8000);
  check(garde6 === 4, "et la copie gardée le reçoit une fois confirmé", garde6);

  // --- 7. Retirer le dossier depuis son menu ------------------------------------------
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Options du dossier « ${pdf.name} »` }).first().click();
  await page.getByRole("menuitem", { name: "Retirer de l'appareil" }).click();
  const restantes = await attendre(
    () => page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("fiches-hors-ligne");
      r.onsuccess = () => { const g = r.result.transaction("notes").objectStore("notes").getAllKeys(); g.onsuccess = () => res(g.result); };
    })),
    (cles) => !cles.includes(pdf.id),
    8000,
  );
  check(!restantes.includes(pdf.id) && restantes.includes(noteId), "retirer le dossier libère sa note, pas celle gardée à part");

  check(erreurs.length === 0, "aucune erreur de page", erreurs.join(" | "));
} finally {
  await browser.close();
  if (noteId) db.prepare(`DELETE FROM "Note" WHERE id = ?`).run(noteId);
  db.close();
}

console.log(echecs === 0 ? "\nTout est bon." : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
