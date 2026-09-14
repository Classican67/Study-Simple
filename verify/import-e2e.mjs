/*
 * Importer un document depuis le système, dans le bon dossier.
 *
 * Trois chemins y mènent, et ils ne sont pas offerts par les mêmes appareils :
 *
 * 1. **Le glisser-déposer** d'un fichier sur la liste des notes. C'est le seul
 *    qui fonctionne sur iPad — on tire le PDF depuis Fichiers, en écran
 *    partagé — et c'est donc celui qui compte le plus ici.
 * 2. **La feuille de partage** du système (`share_target`), sur Android et
 *    ChromeOS. Elle **navigue** vers la route d'import et attend une page en
 *    retour, là où le glisser-déposer appelle en XHR et attend du JSON : les
 *    deux réponses se vérifient donc séparément.
 * 3. **« Ouvrir avec »** (`file_handlers`), sur les navigateurs de bureau à
 *    base de Chromium.
 *
 * Ce qui compte dans les trois cas : le document atterrit **là où l'on
 * regarde**, et la note porte le nom du fichier.
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 160));
  ko++;
});

const pdf = readFileSync("doc-test.pdf");

/**
 * Dépose des fichiers sur la page, comme le ferait un glissement depuis
 * Fichiers ou l'explorateur.
 *
 * Le `DataTransfer` est fabriqué dans la page : c'est le seul moyen d'obtenir
 * un vrai `File` dans les événements de glissement, et c'est exactement ce que
 * le navigateur y met.
 */
const deposer = (fichiers) =>
  page.evaluate(async ({ fichiers }) => {
    const dt = new DataTransfer();
    for (const f of fichiers) {
      const octets = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([octets], f.nom, { type: f.type }));
    }
    const evenement = (type) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      window.dispatchEvent(e);
      return e;
    };
    evenement("dragenter");
    const survol = evenement("dragover");
    await new Promise((r) => setTimeout(r, 120));
    const voile = document.querySelector('[role="status"], .border-dashed');
    const annonce = voile?.textContent ?? "";
    evenement("drop");
    return { refuse: survol.defaultPrevented, annonce };
  }, { fichiers });

const base64 = pdf.toString("base64");
const unPdf = (nom) => ({ nom, type: "application/pdf", base64 });

// --- 1. Le glisser-déposer, dans un dossier ---------------------------------
section("déposer un document dans un dossier");

// Un dossier de notes à soi, pour vérifier que le document s'y range.
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const dossier = `Import ${Date.now()}`;
await page.getByRole("button", { name: "Dossier", exact: true }).click();
await page.getByLabel(/Nom/).fill(dossier);
await page.getByRole("button", { name: /Créer|Enregistrer/ }).click();
await page.waitForTimeout(1500);
await page.getByRole("link", { name: new RegExp(dossier) }).first().click();
await page.waitForURL(/folder=/);
await page.waitForTimeout(800);
const urlDossier = page.url();
const idDossier = new URL(urlDossier).searchParams.get("folder");
dire("dossier ouvert", idDossier);

const avant = await page.locator('a[href^="/notes/"]').count();
const nomFichier = `Cours de biologie ${Date.now()}`;
const geste = await deposer([unPdf(`${nomFichier}.pdf`)]);
check(geste.refuse, "le glissement d'un fichier est accepté par la page", "sans cela le navigateur ouvre le PDF");
check(
  /Déposer pour en faire une note/.test(geste.annonce),
  "et l'app annonce ce qui va se passer",
  geste.annonce.slice(0, 80),
);
check(
  geste.annonce.includes(dossier),
  "en disant dans quel dossier le document atterrira",
  geste.annonce.slice(0, 120),
);

// Un seul document : on l'ouvre, c'est ce qu'on venait faire.
await page.waitForURL(/\/notes\/[a-z0-9]+$/, { timeout: 60000 });
await page.waitForSelector('[data-testid="drawing-canvas"]', { timeout: 60000 });
await page.waitForTimeout(1500);
check(true, "le document déposé devient une note, ouverte aussitôt");
check(
  (await page.getByLabel("Titre de la note").inputValue()) === nomFichier,
  "qui porte le nom du fichier",
  await page.getByLabel("Titre de la note").inputValue(),
);
const pagesRendues = await page.evaluate(
  () => document.querySelectorAll('[aria-label^="Page "][role="img"]').length,
);
check(pagesRendues >= 1, "avec les pages du document", `${pagesRendues} page(s) rendue(s)`);

// Et il est bien rangé dans le dossier où on l'a déposé.
await page.goto(urlDossier, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
check(
  (await page.locator('a[href^="/notes/"]').count()) === avant + 1,
  "et rangé dans le dossier ouvert, pas à la racine",
  `${await page.locator('a[href^="/notes/"]').count()} note(s) pour ${avant + 1} attendue(s)`,
);

// --- 2. Plusieurs documents d'un coup ---------------------------------------
section("déposer plusieurs documents");
const avantPlusieurs = await page.locator('a[href^="/notes/"]').count();
await deposer([unPdf(`Chapitre 1 ${Date.now()}.pdf`), unPdf(`Chapitre 2 ${Date.now()}.pdf`)]);
await page.waitForTimeout(6000);
check(
  page.url().includes("folder="),
  "on reste sur la liste : il y en avait plusieurs",
  page.url(),
);
check(
  (await page.locator('a[href^="/notes/"]').count()) === avantPlusieurs + 2,
  "et les deux notes apparaissent",
  `${await page.locator('a[href^="/notes/"]').count()} pour ${avantPlusieurs + 2} attendues`,
);

// --- 3. Un format refusé -----------------------------------------------------
section("format refusé");
const avantRefus = await page.locator('a[href^="/notes/"]').count();
await deposer([{ nom: "archive.zip", type: "application/zip", base64: Buffer.from("PK").toString("base64") }]);
await page.waitForTimeout(1500);
const alerte = await page.locator('[role="alert"]').first().innerText().catch(() => "");
check(
  /PDF et les documents Word/.test(alerte),
  "un fichier d'un autre genre est refusé, avec un message clair",
  alerte,
);
check(
  (await page.locator('a[href^="/notes/"]').count()) === avantRefus,
  "et rien n'est créé",
);

// --- 4. La feuille de partage ------------------------------------------------
section("feuille de partage et « ouvrir avec »");
const manifeste = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
check(
  manifeste.share_target?.action === "/api/notes/import",
  "le manifeste déclare l'app comme destination de partage",
  JSON.stringify(manifeste.share_target ?? null).slice(0, 80),
);
check(
  manifeste.share_target?.method === "POST" &&
    manifeste.share_target?.enctype === "multipart/form-data",
  "en POST multipart, la seule forme qui transporte un fichier",
);
check(
  (manifeste.share_target?.params?.files ?? []).some(
    (f) => f.name === "document" && f.accept?.includes("application/pdf"),
  ),
  "et elle accepte les PDF",
);
check(
  (manifeste.file_handlers ?? []).some((h) => h.accept?.["application/pdf"]),
  "« Ouvrir avec » est déclaré aussi",
  JSON.stringify(manifeste.file_handlers ?? null).slice(0, 80),
);

/*
 * Le partage **navigue** : il attend une page, pas du JSON. Une redirection
 * vers la note créée est la seule réponse utile — sans quoi la personne
 * resterait devant une réponse brute au lieu de sa note.
 */
const partage = await page.request.post(
  `${BASE}/api/notes/import?dossier=${encodeURIComponent(idDossier)}`,
  {
    headers: { accept: "text/html,application/xhtml+xml" },
    multipart: { document: { name: "Partagé.pdf", mimeType: "application/pdf", buffer: pdf } },
    maxRedirects: 0,
  },
);
dire("réponse au partage", `HTTP ${partage.status()} → ${partage.headers()["location"] ?? "—"}`);
check(partage.status() === 303, "un partage répond par une redirection", `HTTP ${partage.status()}`);
check(
  /\/notes\/[a-z0-9]+$/.test(partage.headers()["location"] ?? ""),
  "vers la note qu'il vient de créer",
  partage.headers()["location"] ?? "",
);

// Et un partage refusé ne laisse pas devant une page d'erreur brute.
const mauvais = await page.request.post(`${BASE}/api/notes/import`, {
  headers: { accept: "text/html" },
  multipart: { document: { name: "x.zip", mimeType: "application/zip", buffer: Buffer.from("PK") } },
  maxRedirects: 0,
});
check(
  mauvais.status() === 303 && (mauvais.headers()["location"] ?? "").includes("/notes?import="),
  "un partage refusé ramène à la liste avec son motif",
  `HTTP ${mauvais.status()} → ${mauvais.headers()["location"] ?? "—"}`,
);

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
