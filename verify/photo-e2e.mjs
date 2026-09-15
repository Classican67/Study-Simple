/*
 * Photographier une page, et écrire dessus.
 *
 * Une photo n'est pas un bloc d'image posé dans la note : c'est une **page
 * manuscrite** dont le fond est la photo, exactement comme une page de
 * document importé. Tout ce que la page sait faire vaut donc pour elle — le
 * stylet, le zoom, le volet des pages, l'export — et c'est précisément ce qu'on
 * vérifie ici : que la photo soit devenue une page, et non une image à côté.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const dire = (label, valeur) => console.log(`   ${label} : ${valeur}`);
const section = (t) => console.log(`\n── ${t} ──`);

// La photo d'essai : 240 × 160, donc un format de 0,667 qui ne se confond avec
// aucune valeur par défaut.
const PHOTO = "photo.png";
const FORMAT = 160 / 240;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 160));
  ko++;
});

/** Les pages posées sur la surface, avec ce qui leur sert de fond. */
const bandes = () =>
  page.evaluate(() => {
    const scroller = document.querySelector("[data-ink-scroll]");
    if (!scroller) return [];
    const feuille = scroller.firstElementChild;
    return [...feuille.children]
      .filter((el) => el.matches("div[aria-hidden]") && !el.hasAttribute("data-ink-tiles"))
      .map((el) => {
        const b = el.getBoundingClientRect();
        const img = el.querySelector("img");
        return {
          ratio: b.height / b.width,
          photo: img ? new URL(img.src).pathname : null,
          document: el.querySelector("canvas") !== null,
        };
      });
  });

const traits = async () => {
  const label = await page.locator('[data-testid="drawing-canvas"]').last().getAttribute("aria-label");
  return Number(/(\d+) trait/.exec(label ?? "")?.[1] ?? -1);
};

// --- Ajouter la photo ---------------------------------------------------------
section("photographier une page");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/").pop();
const titre = `Photo ${Date.now()}`;
await page.getByLabel("Titre de la note").fill(titre);
await page.getByLabel("Titre de la note").blur();
await page.waitForTimeout(600);

const bouton = page.getByRole("button", { name: "Photo", exact: true });
check(await bouton.isVisible(), "la note propose de prendre une photo");
// Un seul bouton, et c'est le menu du système qui offre ensuite « Prendre une
// photo » ou « Photothèque » : c'est `accept="image/*"` qui le déclenche.
check(
  (await page.locator('input[type="file"][accept="image/*"]').count()) === 1,
  "avec un champ qui ouvre l'appareil photo comme la photothèque",
);

await page.locator('input[type="file"][accept="image/*"]').setInputFiles(PHOTO);
await page.waitForTimeout(900);

// Le recadrage : une page photographiée l'est toujours de biais.
const recadreur = page.getByRole("button", { name: "Utiliser" });
check(await recadreur.isVisible(), "le recadreur s'ouvre avant l'envoi");
check(
  (await page.getByRole("button", { name: /Pivoter|Rotation/ }).count()) >= 1,
  "avec de quoi redresser la photo",
);
await recadreur.click();

await page.waitForSelector('[data-testid="drawing-canvas"]', { timeout: 60000 });
await page.waitForTimeout(2000);

// --- C'est une page, pas une image posée à côté -------------------------------
section("la photo est devenue une page");
const posees = await bandes();
dire("pages de la surface", JSON.stringify(posees));
check(posees.length === 1, "la surface porte une page", String(posees.length));
check(Boolean(posees[0]?.photo), "dont le fond est la photo", JSON.stringify(posees[0] ?? {}));
check(
  /^\/api\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(posees[0]?.photo ?? ""),
  "servie sous un nom produit par l'app, jamais celui de l'envoi",
  posees[0]?.photo ?? "",
);
check(
  Math.abs((posees[0]?.ratio ?? 0) - FORMAT) < 0.03,
  "et la page a le format de la photo",
  `${(posees[0]?.ratio ?? 0).toFixed(3)} pour ${FORMAT.toFixed(3)}`,
);

const servie = await page.request.get(`${BASE}${posees[0].photo}`);
check(servie.status() === 200, "la photo se sert correctement", `HTTP ${servie.status()}`);

// --- On écrit dessus -----------------------------------------------------------
section("annoter la photo");
await page.evaluate(async () => {
  const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
  const r = el.getBoundingClientRect();
  const fire = (t, x, y, p, b) =>
    el.dispatchEvent(
      new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
        isPrimary: true, pressure: p, buttons: b,
        clientX: r.left + r.width * x, clientY: r.top + r.width * y,
      }),
    );
  fire("pointerdown", 0.2, 0.2, 0.5, 1);
  for (let i = 1; i <= 30; i++) {
    fire("pointermove", 0.2 + i * 0.015, 0.2 + Math.sin(i / 5) * 0.03, 0.5 + i * 0.008, 1);
    if (i % 3 === 0) await new Promise((r2) => requestAnimationFrame(r2));
  }
  fire("pointerup", 0.65, 0.2, 0, 0);
});
await page.waitForTimeout(1600);
check((await traits()) === 1, "le stylet écrit sur la photo", String(await traits()));

// --- Tout survit au rechargement ----------------------------------------------
section("persistance");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(2500);
const apres = await bandes();
check(apres[0]?.photo === posees[0].photo, "la photo est toujours là", JSON.stringify(apres[0] ?? {}));
check((await traits()) === 1, "et l'annotation aussi", String(await traits()));
check(
  Math.abs((apres[0]?.ratio ?? 0) - FORMAT) < 0.03,
  "avec le même format",
  `${(apres[0]?.ratio ?? 0).toFixed(3)}`,
);

// --- La vignette de la note montre la photo -----------------------------------
section("vignette de la note");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const vignette = await page.evaluate((titre) => {
  const lien = [...document.querySelectorAll('a[href^="/notes/"]')].find((a) =>
    a.textContent?.includes(titre),
  );
  const img = lien?.querySelector("img");
  return img ? new URL(img.src).pathname : null;
}, titre);
check(
  vignette === posees[0].photo,
  "la liste des notes montre la photo en vignette",
  String(vignette),
);

// --- Et le PDF exporté la contient ---------------------------------------------
section("export");
const { PDFDocument, PDFName, PDFDict } = await import("../node_modules/pdf-lib/cjs/index.js");
const reponse = await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=flat`);
check(reponse.status() === 200, "l'export répond", `HTTP ${reponse.status()}`);
const doc = await PDFDocument.load(Buffer.from(await reponse.body()));
check(doc.getPageCount() === 1, "une page exportée", String(doc.getPageCount()));

/*
 * L'image doit être **embarquée**, pas seulement référencée.
 *
 * Une page dont le fond est une photo sortait blanche si l'export l'ignorait,
 * et l'annotation s'y retrouvait suspendue dans le vide — le même défaut que
 * pour les fonds de cahier, et pour la même raison : ce que l'écran affiche en
 * HTML, le PDF ne le sait pas.
 */
const images = (() => {
  const res = doc.getPage(0).node.Resources();
  const xobjets = res?.get(PDFName.of("XObject"));
  const dict = xobjets ? doc.context.lookup(xobjets) : null;
  if (!(dict instanceof PDFDict)) return 0;
  return [...dict.values()].filter((ref) => {
    const flux = doc.context.lookup(ref);
    return String(flux?.dict?.get(PDFName.of("Subtype")) ?? "") === "/Image";
  }).length;
})();
dire("images embarquées", images);
check(images >= 1, "la photo est embarquée dans le PDF", `${images} image(s)`);
check(
  Math.abs(doc.getPage(0).getHeight() / doc.getPage(0).getWidth() - FORMAT) < 0.03,
  "et la page du PDF a le format de la photo",
  `${(doc.getPage(0).getHeight() / doc.getPage(0).getWidth()).toFixed(3)}`,
);

// --- La barre de blocs sur téléphone ------------------------------------------
/*
 * Un bouton de plus dans une rangée déjà pleine.
 *
 * La barre du bas porte maintenant Texte, Tableau, Croquis, PDF, Photo et
 * Document. Aucun audit ne la visite : elle n'existe qu'au bas d'une note
 * ouverte, et les captures générales s'arrêtent à la liste.
 */
section("la barre de blocs sur téléphone");
const tel = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
});
await tel.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const petit = await tel.newPage();
await petit.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
await petit.waitForSelector('[data-testid="drawing-canvas"]');
await petit.waitForTimeout(2000);

check(
  await petit.getByRole("button", { name: "Photo", exact: true }).isVisible(),
  "le bouton Photo y trouve sa place",
);
const deborde = await petit.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
check(deborde <= 0, "sans faire déborder la page", `${deborde} px`);
const petitsBoutons = await petit.evaluate(() => {
  const trop = [];
  for (const b of document.querySelectorAll("main button")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.height < 44) trop.push(`${b.textContent?.trim()} ${Math.round(r.height)} px`);
  }
  return trop;
});
check(petitsBoutons.length === 0, "et chaque bouton reste attrapable au doigt", petitsBoutons.join(", "));
await petit.screenshot({ path: "shots/note-barre-telephone.png" });
await tel.close();

// --- L'encre reste lisible en thème sombre ------------------------------------
/*
 * Une photo ne suit pas le thème de l'application.
 *
 * L'encre, elle, le suivait : en thème sombre le stylo écrit en blanc, et l'on
 * annotait donc une photo claire à l'encre blanche. Le même défaut existait
 * déjà sur les documents importés — un polycopié blanc annoté en blanc — sans
 * que rien ne le signale, car aucun audit ne regarde la couleur d'un trait
 * posé sur une image.
 *
 * On mesure la couleur **réellement peinte** sur les tuiles, et non la variable
 * CSS : c'est ce que l'œil reçoit.
 */
section("encre sur une photo, en thème sombre");
const sombre = await browser.newContext({
  viewport: { width: 1194, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
await sombre.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const nuit = await sombre.newPage();
await nuit.goto(`${BASE}/notes/${noteId}`, { waitUntil: "networkidle" });
await nuit.waitForSelector('[data-testid="drawing-canvas"]');
await nuit.waitForTimeout(2500);

const encre = await nuit.evaluate(() => {
  let r = 0;
  let v = 0;
  let b = 0;
  let n = 0;
  for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
    const ctx = c.getContext("2d");
    if (!ctx || c.width === 0) continue;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < data.length; i += 4) {
      // Seuls les pixels pleinement opaques : les bords sont lissés, et les
      // compter tirerait la moyenne vers le fond.
      if (data[i + 3] < 250) continue;
      r += data[i];
      v += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? { r: r / n, v: v / n, b: b / n, n } : null;
});
dire(
  "couleur de l'encre",
  encre ? `rgb(${Math.round(encre.r)}, ${Math.round(encre.v)}, ${Math.round(encre.b)}) sur ${encre.n} pixels` : "aucune",
);
check(Boolean(encre) && encre.n > 200, "l'annotation est peinte", String(encre?.n ?? 0));
const clarte = encre ? (0.2126 * encre.r + 0.7152 * encre.v + 0.0722 * encre.b) / 255 : 1;
check(
  clarte < 0.35,
  "et son encre reste sombre sur la photo, même en thème sombre",
  `clarté ${clarte.toFixed(2)} — au-delà de 0,5 c'est du blanc sur une image claire`,
);
await sombre.close();

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
