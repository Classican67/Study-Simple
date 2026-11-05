/*
 * Du texte sur la feuille, et des symboles mathématiques jusque dans le PDF.
 *
 * Le PDF est relu par pdf.js : un `drawText` qui a réussi ne prouve rien, c'est ce
 * qu'un lecteur en tire qui compte. Sa place y est comparée à celle de l'écran.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});

const base = new DatabaseSync("verif.db", { timeout: 4000 });
const TITRE = `Texte ${Date.now()}`;
let noteId;
const contenu = () => {
  try {
    return JSON.parse(base.prepare("SELECT content FROM NoteBlock WHERE noteId = ? LIMIT 1").get(noteId).content);
  } catch {
    return null;
  }
};
async function attendre(test, ms = 7000) {
  const fin = Date.now() + ms;
  for (;;) {
    const c = contenu();
    if (c && test(c)) return c;
    if (Date.now() > fin) return c;
    await page.waitForTimeout(100);
  }
}
const canvas = () => page.locator('[data-testid="drawing-canvas"]').first();

try {
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  noteId = page.url().split("/").at(-1);
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await canvas().waitFor();
  await page.waitForTimeout(500);

  console.log("— écrire");
  await page.getByRole("button", { name: "Zone de texte" }).first().click();
  const b = await canvas().boundingBox();
  await page.mouse.click(b.x + 200, b.y + 200);
  const editeur = page.getByRole("textbox", { name: "Zone de texte" });
  await editeur.waitFor();
  check(await editeur.evaluate((el) => document.activeElement === el), "toucher la page ouvre une zone, curseur dedans");

  // Rien tapé : aucune trace.
  await page.mouse.click(b.x + 700, b.y + 500);
  await page.waitForTimeout(900);
  check((contenu()?.textes ?? []).length === 0, "une zone laissée vide ne laisse rien");

  await page.mouse.click(b.x + 200, b.y + 200);
  await editeur.waitFor();
  await page.keyboard.type("Somme ");
  await page.getByRole("button", { name: "Caractères mathématiques" }).click();
  await page.getByPlaceholder(/Chercher|chercher|symbole/i).fill("somme");
  await page.getByRole("button", { name: /^Somme|sigma/i }).first().click();
  await editeur.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" λ ≤ 3 ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("important");
  await page.keyboard.press("ControlOrMeta+b");
  await page.mouse.click(b.x + 800, b.y + 520);
  let c = await attendre((d) => d.textes.length === 1);
  const markup = c?.textes[0]?.markup ?? "";
  check(c?.textes.length === 1, "la zone part en base", markup);
  check(/∑/.test(markup) && /λ/.test(markup), "avec ses symboles, comme de simples caractères");
  check(/\*\*important\*\*/.test(markup), "et son gras");
  const lue = await page.locator("[data-zone-texte]").first().textContent();
  check(/∑/.test(lue) && !/\*\*/.test(lue), "à l'écran, sans marqueur visible", lue.slice(0, 40));
  check(Math.abs(c.textes[0].h - (await page.locator("[data-zone-texte]").first().evaluate((el) => el.offsetHeight / el.parentElement.offsetWidth))) < 0.01, "sa hauteur est celle de l'écran");

  const couleur = await page.locator("[data-zone-texte]").first().evaluate((el) => getComputedStyle(el).color);
  check(Boolean(couleur), "et sa couleur est l'encre de la page", couleur);

  console.log("— rouvrir, déplacer, agrandir");
  await page.mouse.click(b.x + 210, b.y + 205);
  await editeur.waitFor();
  check((await editeur.textContent()).includes("important"), "toucher une zone la rouvre");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(" suite");
  await page.keyboard.press("Escape");
  c = await attendre((d) => /suite/.test(d.textes[0].markup));
  check(/suite/.test(c.textes[0].markup) && c.textes.length === 1, "Échap referme et garde ce qui est écrit");

  await page.getByRole("button", { name: "Lasso", exact: true }).first().click();
  await page.mouse.click(b.x + 210, b.y + 205);
  const cadre = page.locator('[data-testid="cadre-selection"]');
  await cadre.waitFor();
  check(true, "le lasso la saisit d'un toucher");
  const x0 = c.textes[0].x;
  const t0 = c.textes[0].taille;
  const bc = await cadre.boundingBox();
  await page.mouse.move(bc.x + bc.width / 2, bc.y + bc.height / 2);
  await page.mouse.down();
  await page.mouse.move(bc.x + bc.width / 2 + 90, bc.y + bc.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  c = await attendre((d) => d.textes[0].x !== x0);
  check(c.textes[0].x > x0, "elle se déplace");
  const coin = await page.locator('[data-poignee="se"]').boundingBox();
  await page.mouse.move(coin.x + 22, coin.y + 22);
  await page.mouse.down();
  await page.mouse.move(coin.x + 122, coin.y + 72, { steps: 5 });
  await page.mouse.up();
  c = await attendre((d) => d.textes[0].taille !== t0);
  check(c.textes[0].taille > t0, "le coin agrandit le texte", `${t0} → ${c.textes[0].taille}`);

  await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
  c = await attendre((d) => d.textes[0].taille === t0);
  check(c.textes[0].taille === t0, "Annuler rend sa taille");

  console.log("— coller sur la feuille");
  await page.evaluate(async () =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<h2>Le rein</h2><ul><li>Cortex<ul><li>Glomérule</li></ul></li></ul>"], { type: "text/html" }),
        "text/plain": new Blob(["Le rein"], { type: "text/plain" }),
      }),
    ]),
  );
  await page.mouse.click(b.x + 900, b.y + 100);
  await page.keyboard.press("ControlOrMeta+v");
  c = await attendre((d) => d.textes.length === 2);
  check(c.textes.length === 2, "un texte collé devient une zone, sans bloc en plus");
  check(/## Le rein/.test(c.textes[1].markup) && / {2}- Glomérule/.test(c.textes[1].markup), "et garde sa structure", JSON.stringify(c.textes[1].markup));
  const blocs = base.prepare("SELECT count(*) AS n FROM NoteBlock WHERE noteId = ?").get(noteId).n;
  check(blocs === 1, "la note reste une seule feuille");
  await page.screenshot({ path: "shots/texte-feuille.png" });

  console.log("— chercher");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  const r = await page.evaluate(async () => (await fetch("/notes?q=glomerule")).text());
  check(r.includes(TITRE), "le texte d'une zone se retrouve par la recherche, sans accent");

  console.log("— le PDF");
  await page.waitForTimeout(800);
  const pdf = await ctx.request.get(`${BASE}/api/notes/${noteId}/pdf`);
  check(pdf.ok(), "l'export répond", String(pdf.status()));
  const octets = await pdf.body();
  writeFileSync("shots/texte.pdf", octets);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(octets), verbosity: 0 }).promise;
  const p1 = await doc.getPage(1);
  const lu = await p1.getTextContent();
  const texte = lu.items.map((i) => i.str).join(" ");
  check(texte.includes("∑"), "∑ est dans le PDF, lisible par un lecteur", texte.slice(0, 80));
  check(texte.includes("λ") && texte.includes("≤"), "λ et ≤ aussi");
  check(texte.includes("important"), "le mot en gras aussi");
  const polices = new Set(lu.items.map((i) => i.fontName));
  check(polices.size >= 2, "le gras a sa propre police", `${polices.size} polices`);
  check(texte.includes("Glomérule") && texte.includes("Le rein"), "le texte collé aussi");
  // La taille d'un PDF : les polices sont réduites à ce qui sert.
  check(octets.length < 400_000, "seules les lettres employées pèsent", `${Math.round(octets.length / 1024)} Ko`);

  const item = lu.items.find((i) => i.str.includes("Somme"));
  const vue = p1.getViewport({ scale: 1 });
  const px = item.transform[4] / vue.width;
  check(Math.abs(px - c.textes[0].x) < 0.015, "le texte sort du papier à sa place, en largeur", `${px.toFixed(3)} pour ${c.textes[0].x.toFixed(3)}`);

  console.log("— l'encre fraîche ne se perd pas");
  await page.getByRole("button", { name: "Écrire", exact: true }).first().click();
  await canvas().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, pr, bt) =>
      el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: pr, buttons: bt, clientX: r.left + r.width * x, clientY: r.top + 300 }));
    f("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", 0.2 + i * 0.02, 0.45, 1);
    f("pointerup", 0.5, 0, 0);
  });
  // Aussitôt après le trait : changer de fond lit le contenu, et réécrit tout.
  await page.getByRole("button", { name: "Réglages de la page" }).first().click();
  await page.getByRole("button", { name: "Carreaux", exact: true }).click();
  c = await attendre((d) => d.strokes.length === 1 && d.paper === "grid");
  check(c.strokes.length === 1 && c.paper === "grid", "une commande touchée juste après un trait ne le perd pas", `${c.strokes.length} trait, fond ${c.paper}`);

  await canvas().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const f = (t, x, pr, bt) =>
      el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true, pressure: pr, buttons: bt, clientX: r.left + r.width * x, clientY: r.top + 340 }));
    f("pointerdown", 0.2, 0.5, 1);
    for (let i = 1; i < 14; i++) f("pointermove", 0.2 + i * 0.02, 0.45, 1);
    f("pointerup", 0.5, 0, 0);
  });
  await page.getByRole("link", { name: "Revenir aux notes" }).click();
  c = await attendre((d) => d.strokes.length === 2);
  check(c.strokes.length === 2, "quitter la note juste après un trait ne le perd pas");

  console.log("— mesures de l'éditeur");
  for (const schema of ["light", "dark"]) {
    for (const [nom, w, h] of [["téléphone", 393, 852], ["desktop", 1280, 900]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await c2.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
      const p = await c2.newPage();
      await p.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
      await p.evaluate((s) => document.documentElement.classList.toggle("dark", s === "dark"), schema);
      await p.getByRole("button", { name: "Zone de texte" }).first().click();
      const cv = await p.locator('[data-testid="drawing-canvas"]').first().boundingBox();
      await p.mouse.click(cv.x + cv.width * 0.3, cv.y + 90);
      await p.getByRole("textbox", { name: "Zone de texte" }).waitFor();
      await p.waitForTimeout(250);
      const petits = await p.evaluate(() =>
        [...document.querySelectorAll("[data-editeur-texte] button")]
          .map((el) => ({ n: el.getAttribute("aria-label") ?? "?", r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width < 40 || r.height < 40)
          .map(({ n, r }) => `${n} ${Math.round(r.width)}×${Math.round(r.height)}`),
      );
      check(petits.length === 0, `barre de texte, cibles — ${nom}, ${schema}`, petits.slice(0, 3).join(", "));
      const dehors = await p.evaluate(() => {
        const r = document.querySelector("[data-editeur-texte] [role=textbox]").parentElement.firstElementChild.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      });
      check(!dehors, `la barre reste à l'écran — ${nom}, ${schema}`);
      await p.screenshot({ path: `shots/texte-${nom}-${schema}.png` });
      await c2.close();
    }
  }
} catch (e) {
  console.log("❌ arrêt :", e);
  echecs++;
}
await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
