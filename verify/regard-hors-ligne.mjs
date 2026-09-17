/*
 * Le hors ligne, regardé et mesuré.
 *
 * `audit.mjs` ne voit ni la puce « Garder hors ligne » dans ses états
 * épinglé et hérité, ni la page hors ligne : elles n'existent qu'une fois
 * quelque chose descendu, et la seconde qu'une fois le réseau coupé. Ce
 * script les fait exister, puis les photographie en clair et en sombre, sur
 * téléphone et en desktop, en mesurant contraste et cibles tactiles.
 *
 * Captures dans `shots/hors-ligne-*.png` — à ouvrir.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { token, userId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
mkdirSync("shots", { recursive: true });

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail !== "" ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

// Données d'essai : un dossier, un sous-dossier, deux paquets.
const db = new DatabaseSync("verif.db");
const TS = Date.now();
const id = (p) => `rg${p}${TS.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const F = id("f");
const S = id("s");
const D1 = id("d");
const D2 = id("d");
const t = Date.now();
db.prepare(`INSERT INTO "Folder" (id, ownerId, parentId, kind, name, color, createdAt, updatedAt) VALUES (?, ?, NULL, 'deck', 'Biologie cellulaire', 'emerald', ?, ?)`).run(F, userId, t, t);
db.prepare(`INSERT INTO "Folder" (id, ownerId, parentId, kind, name, color, createdAt, updatedAt) VALUES (?, ?, ?, 'deck', 'Organites', 'blue', ?, ?)`).run(S, userId, F, t, t);
db.prepare(`INSERT INTO "Deck" (id, ownerId, folderId, title, description, color, createdAt, updatedAt) VALUES (?, ?, ?, 'Mitochondrie', 'Structure et respiration', 'violet', ?, ?)`).run(D1, userId, S, t, t);
db.prepare(`INSERT INTO "Deck" (id, ownerId, folderId, title, description, color, createdAt, updatedAt) VALUES (?, ?, NULL, 'Capitales d''Amérique du Sud', '', 'amber', ?, ?)`).run(D2, userId, t, t);
const ins = db.prepare(`INSERT INTO "Card" (id, deckId, term, definition, imagePath, searchText, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, '', ?, ?, ?)`);
[
  [D1, "Crête mitochondriale", "Repli de la membrane interne qui augmente la surface d'échange."],
  [D1, "Matrice", "Espace intérieur où se déroule le cycle de Krebs."],
  [D1, "ATP synthase", "Enzyme qui produit l'ATP grâce au gradient de protons."],
  [D2, "Pérou", "Lima"],
  [D2, "Chili", "Santiago"],
].forEach(([d, term, def], i) => ins.run(id("c"), d, term, def, i, t, t));

// Une note à polycopié, rangée dans un dossier de notes, dans la copie de base.
const notePdf = db
  .prepare(
    `SELECT n.id, n.folderId, f.name FROM "NoteBlock" b JOIN "Note" n ON n.id = b.noteId JOIN "Folder" f ON f.id = n.folderId WHERE b.content LIKE ? AND f.kind = 'note' LIMIT 1`,
  )
  .get("%.pdf%");

const CONTRASTE = `(() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgb = (c) => { cx.clearRect(0,0,1,1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0,0,1,1); return [...cx.getImageData(0,0,1,1).data].slice(0,3); };
  const lum = ([r,g,b]) => { const f = (v) => (v/=255) <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const fond = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && !b.startsWith("rgba(0, 0, 0, 0)") && b !== "transparent") return b; } return getComputedStyle(document.body).backgroundColor; };
  const out = [];
  for (const el of document.querySelectorAll("[data-testid=hors-ligne] span, [data-testid=statut-hors-ligne], [data-testid=bandeau-en-attente], [data-testid=page-indisponible], main h1, main p, main span, header span, button, a")) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!txt) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(fond(el)))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const taille = parseFloat(cs.fontSize);
    const besoin = taille >= 24 || (taille >= 18.66 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio < besoin) out.push(txt.slice(0, 30) + " " + ratio.toFixed(2));
  }
  return out;
})()`;

const CIBLES = `(() => [...document.querySelectorAll("button, a, [role=button]")]
  .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.opacity !== "0" && !el.closest("[aria-hidden=true]"); })
  .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
  .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30) + " " + Math.round(el.getBoundingClientRect().width) + "×" + Math.round(el.getBoundingClientRect().height)))()`;

const APPAREILS = [
  { nom: "telephone", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { nom: "desktop", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
];

const browser = await chromium.launch();
try {
  for (const appareil of APPAREILS) {
    for (const theme of ["light", "dark"]) {
      const { nom, ...options } = appareil;
      const ctx = await browser.newContext({ ...options, colorScheme: theme });
      await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      await ctx.addInitScript((th) => {
        try {
          localStorage.setItem("fiches-theme", th);
        } catch {}
      }, theme);
      const page = await ctx.newPage();
      const tag = `${nom}-${theme === "dark" ? "sombre" : "clair"}`;
      const mesurer = async (ecran) => {
        await page.waitForTimeout(400);
        const contraste = await page.evaluate(CONTRASTE);
        const cibles = await page.evaluate(CIBLES);
        check(contraste.length === 0, `${ecran} ${tag} : contraste`, contraste.join(" | "));
        check(cibles.length === 0, `${ecran} ${tag} : cibles tactiles`, cibles.join(" | "));
        const debord = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        check(debord <= 0, `${ecran} ${tag} : pas de débordement horizontal`, debord);
        await page.screenshot({ path: `shots/hors-ligne-${ecran}-${tag}.png` });
      };
      const etat = (e) =>
        page.waitForFunction((x) => document.querySelector("[data-testid=hors-ligne]")?.dataset.etat === x, e, { timeout: 20000 });

      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload({ waitUntil: "networkidle" });

      // Puce, trois états
      await page.goto(`${BASE}/decks/${D2}`, { waitUntil: "networkidle" });
      await etat("absent");
      await mesurer("puce-absente");
      await page.locator("[data-testid=hors-ligne]").click();
      await etat("disponible");
      await mesurer("puce-disponible");
      await page.goto(`${BASE}/folders/${F}`, { waitUntil: "networkidle" });
      await etat("absent");
      await page.locator("[data-testid=hors-ligne]").click();
      await etat("disponible");
      await mesurer("dossier");
      await page.goto(`${BASE}/decks/${D1}`, { waitUntil: "networkidle" });
      await etat("herite");
      await mesurer("puce-heritee");
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-testid=pastille-hors-ligne]");
      await mesurer("grille");

      // Notes : l'option du menu, puis le dossier gardé
      if (notePdf) {
        await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: `Options du dossier « ${notePdf.name} »` }).first().click();
        await page.getByRole("menuitem", { name: "Garder hors ligne" }).waitFor();
        await mesurer("menu-notes");
        await page.getByRole("menuitem", { name: "Garder hors ligne" }).click();
        await page
          .locator(`a[href="/notes?folder=${notePdf.folderId}"] [data-testid="pastille-hors-ligne"]`)
          .first()
          .waitFor({ timeout: 20000 });
        // Le polycopié et le worker de pdf.js doivent être descendus avant de couper.
        await page.waitForFunction(
          async () => (await (await caches.open("fiches-coquille")).keys()).some((r) => r.url.endsWith("/pdf.worker.min.mjs")),
          null,
          { timeout: 30000, polling: 500 },
        );
        await page.waitForFunction(
          async () => (await (await caches.open("fiches-fichiers")).keys()).some((r) => r.url.endsWith(".pdf")),
          null,
          { timeout: 30000, polling: 500 },
        );
      }

      // Page hors ligne
      await ctx.setOffline(true);
      await page.goto(`${BASE}/decks/${D1}/study?all=1`);
      await page.getByRole("button", { name: "Je savais" }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Je savais" }).click();
      await page.waitForTimeout(500);
      await mesurer("revision");
      await page.goto(`${BASE}/`);
      await page.waitForSelector("[data-testid=bandeau-en-attente]", { timeout: 15000 });
      await mesurer("accueil");
      await page.goto(`${BASE}/folders/${F}`);
      await page.waitForSelector("text=Réviser", { timeout: 15000 });
      await mesurer("coquille-dossier");
      await page.goto(`${BASE}/decks/${D1}`);
      await page.waitForSelector("[data-testid=carte-hors-ligne]", { timeout: 15000 });
      await mesurer("coquille-paquet");
      if (notePdf) {
        await page.goto(`${BASE}/notes?folder=${notePdf.folderId}`);
        await page.waitForSelector("[data-testid=note-hors-ligne]", { timeout: 15000 });
        await mesurer("coquille-notes");
        await page.goto(`${BASE}/notes/${notePdf.id}`);
        await page.locator('canvas[aria-label="Page 1 du document importé"]').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        await mesurer("coquille-note");
      }
      await page.goto(`${BASE}/admin`);
      await page.waitForSelector("[data-testid=page-indisponible]", { timeout: 15000 });
      await mesurer("indisponible");
      await ctx.setOffline(false);
      await page.waitForTimeout(1500);
      if (notePdf) {
        await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: `Options du dossier « ${notePdf.name} »` }).first().click();
        await page.getByRole("menuitem", { name: "Retirer de l'appareil" }).click();
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  db.prepare(`DELETE FROM "Deck" WHERE id IN (?, ?)`).run(D1, D2);
  db.prepare(`DELETE FROM "Folder" WHERE id IN (?, ?)`).run(S, F);
  db.close();
}

console.log(echecs === 0 ? "\nTout est bon — ouvrir shots/hors-ligne-*.png." : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
