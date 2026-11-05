/*
 * Coller en gardant la structure, et l'image dans le fil d'une note à blocs.
 *
 * À lancer sur un serveur `NOTES_FORMAT_DEFAUT=blocs` : les blocs de texte n'existent
 * plus que dans les notes d'avant. Le presse-papiers est le vrai : c'est lui qui
 * décide ce que `clipboardData` donne à la page.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let echecs = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 1000 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 200));
  echecs++;
});
const base = new DatabaseSync("verif.db", { timeout: 3000 });
const TITRE = `Collage ${Date.now()}`;

const blocs = () => {
  const note = base.prepare("SELECT id FROM Note WHERE title = ? ORDER BY createdAt DESC LIMIT 1").get(TITRE);
  return note ? base.prepare("SELECT id, kind, content FROM NoteBlock WHERE noteId = ? ORDER BY position").all(note.id) : [];
};
async function attendre(test, ms = 6000) {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      const b = blocs();
      if (test(b)) return b;
    } catch {}
    if (Date.now() > fin) return blocs();
    await page.waitForTimeout(100);
  }
}
const presse = (html, texte) =>
  page.evaluate(
    async ([h, t]) =>
      navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([h], { type: "text/html" }),
          "text/plain": new Blob([t], { type: "text/plain" }),
        }),
      ]),
    [html, texte],
  );

try {
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).first().click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.getByLabel("Titre de la note").fill(TITRE);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForTimeout(500);
  check((await page.locator('section[aria-label^="Bloc"]').count()) === 1, "serveur en notes à blocs");

  await page.getByRole("button", { name: "Texte", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Bloc paragraphe" }).first().waitFor();
  const champ = page.getByRole("textbox", { name: "Bloc paragraphe" }).first();
  await champ.click();

  console.log("— collage dans un texte");
  await presse(
    "<h2>Le rein</h2><p>Un <strong>filtre</strong>.</p><ul><li>Cortex<ul><li>Glomérule</li></ul></li><li>Médullaire</li></ul>",
    "Le rein",
  );
  await page.keyboard.press("ControlOrMeta+v");
  let b = await attendre((l) => l.some((x) => x.kind === "text" && /Glom/.test(x.content)));
  const texte = JSON.parse(b.find((x) => x.kind === "text").content).markup;
  check(texte === "## Le rein\nUn **filtre**.\n- Cortex\n  - Glomérule\n- Médullaire", "titre, gras et liste imbriquée entrent", JSON.stringify(texte));
  check((await champ.locator("h2").count()) === 1, "le titre est un titre à l'écran");
  check((await champ.locator("ul ul li").count()) === 1, "la liste est imbriquée à l'écran");

  await page.reload({ waitUntil: "networkidle" });
  const rouvert = page.getByRole("textbox", { name: "Bloc paragraphe" }).first();
  check((await rouvert.locator("h2").count()) === 1 && (await rouvert.locator("ul ul li").count()) === 1, "tout survit à la réouverture");

  console.log("— Tab dans une liste");
  await rouvert.locator("li", { hasText: "Médullaire" }).click();
  await page.keyboard.press("Tab");
  b = await attendre((l) => /  - Médullaire/.test(l.find((x) => x.kind === "text")?.content ?? ""));
  check(/ {2}- Médullaire/.test(b.find((x) => x.kind === "text").content.replace(/\\n/g, "\n")), "Tab descend d'un niveau");

  console.log("— tableau au milieu");
  await rouvert.click();
  await page.keyboard.press("ControlOrMeta+End");
  await presse("<p>Avant</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p>Après</p>", "x");
  await page.keyboard.press("ControlOrMeta+v");
  b = await attendre((l) => l.filter((x) => x.kind === "table").length === 1 && l.filter((x) => x.kind === "text").length === 2);
  const genres = b.map((x) => x.kind);
  check(genres.join() === "drawing,text,table,text", "le tableau devient un bloc, à sa place", genres.join());
  check(JSON.parse(b[2].content).rows[1][1] === "2", "avec ses cellules");

  console.log("— plage collée dans un tableau");
  const cellule = page.getByRole("textbox", { name: "A2", exact: true }).first();
  await cellule.click();
  await presse("<table><tr><td>x</td><td>y</td><td>z</td></tr><tr><td>u</td><td>v</td><td>w</td></tr></table>", "x\ty\tz\nu\tv\tw");
  await page.keyboard.press("ControlOrMeta+v");
  b = await attendre((l) => JSON.parse(l.find((x) => x.kind === "table").content).rows.length >= 3 && /w/.test(l.find((x) => x.kind === "table").content));
  const lignes = JSON.parse(b.find((x) => x.kind === "table").content).rows;
  check(lignes[1].join() === "x,y,z" && lignes[2].join() === "u,v,w", "la plage remplit et agrandit le tableau", JSON.stringify(lignes));

  console.log("— copier un bloc");
  await page.getByRole("button", { name: /^Copier le bloc/ }).nth(1).click();
  await page.waitForTimeout(300);
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  check(types.includes("text/html"), "le tableau part en HTML", types.join());
  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  check(tsv.includes("\t"), "et en tabulations pour un tableur");

  console.log("— image dans le fil");
  await page.locator("input[data-bloc-image]").setInputFiles("photo.png");
  b = await attendre((l) => l.some((x) => x.kind === "image"));
  const bloc = () => JSON.parse(blocs().find((x) => x.kind === "image").content);
  check(bloc().largeur === 1, "l'image arrive en pleine largeur");
  await page.getByRole("button", { name: "50 %" }).click();
  b = await attendre(() => bloc().largeur === 0.5);
  check(bloc().largeur === 0.5, "« 50 % » la réduit");
  const img = page.locator("figure img").first();
  await img.waitFor();
  const colonne = await page.locator("figure > div").first().boundingBox();
  const avant = await img.boundingBox();
  check(Math.abs(avant.width - colonne.width / 2) < 2, "à l'écran aussi", `${avant.width} sur ${colonne.width}`);

  await img.scrollIntoViewIfNeeded();
  const poignee = await page.locator('[data-poignee-image="droite"]').boundingBox();
  await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
  await page.mouse.down();
  await page.mouse.move(poignee.x + poignee.width / 2 + 60, poignee.y + 20, { steps: 5 });
  await page.mouse.up();
  await attendre(() => bloc().largeur > 0.55);
  check(bloc().largeur > 0.55, "la poignée la redimensionne, et le geste s'enregistre", String(bloc().largeur));

  await page.locator('[data-poignee-image="droite"]').focus();
  const l0 = bloc().largeur;
  await page.keyboard.press("ArrowRight");
  await attendre(() => bloc().largeur > l0);
  check(bloc().largeur > l0, "au clavier aussi");

  await page.getByRole("button", { name: "Aligner à droite" }).click();
  await page.getByLabel("Légende de l'image").fill("Coupe du rein");
  await attendre(() => bloc().legende === "Coupe du rein");
  check(bloc().align === "right" && bloc().legende === "Coupe du rein", "alignement et légende partent en base");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("figure img").first().waitFor();
  check(await page.locator("figure img").first().evaluate((i) => i.naturalWidth > 0), "l'image revient au rechargement");

  const noteId = page.url().split("/").at(-1);
  const pdf = await ctx.request.get(`${BASE}/api/notes/${noteId}/pdf`);
  const octets = Buffer.from(await pdf.body()).toString("latin1");
  check(pdf.ok() && /\/Subtype\s*\/Image/.test(octets), "le PDF embarque l'image du fil");
} catch (e) {
  console.log("❌ arrêt :", e);
  echecs++;
}
await browser.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
