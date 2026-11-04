/*
 * **La sauvegarde Google Drive, de bout en bout**, contre un faux Google
 * (`faux-google.mjs`) strict sur ce que le vrai exige.
 *
 * Le script lance son propre serveur, sur le port 3101, avec la configuration
 * Google pointée sur le faux : le serveur de vérification habituel (3100)
 * reste sans Google, comme une installation qui ne l'a pas configuré.
 *
 * Ce qu'il prouve :
 *
 * 1. la liaison suit les règles d'OAuth — `state`, PKCE, `access_type=offline`,
 *    portée `drive.file` seule, code échangé au serveur ;
 * 2. la première passe dépose tout, rangé comme dans l'app : PDF annoté,
 *    Markdown, paquets, notes brutes, fichiers d'origine ;
 * 3. une passe sans changement n'envoie **rien** ; une note modifiée n'envoie
 *    qu'elle, **sur place** (même fichier, une version de plus) ;
 * 4. une note rangée ailleurs est déplacée, une note supprimée part à la
 *    corbeille ;
 * 5. une panne passagère de Google est absorbée par la reprise ;
 * 6. la table de correspondance perdue ne fait pas de doublons, le dossier
 *    « Fiches » mis à la corbeille est refait ;
 * 7. un accès retiré se dit (« À relier ») au lieu d'échouer en silence ;
 * 8. délier révoque le jeton et laisse les fichiers dans le Drive.
 *
 * Et comme ces états n'existent que reliés, `audit.mjs` ne les voit pas : la
 * page y est mesurée — contraste, 44 px, positions — en clair et en sombre,
 * sur téléphone et en desktop.
 */
import { chromium } from "playwright";
import { copyFileSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { demarrerFauxGoogle } from "./faux-google.mjs";
import { CONTRAST, POSITION, TOUCH } from "./sondes.mjs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const GOOGLE = 3199;
const RACINE = path.resolve("..");
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const dire = (label, valeur) => console.log(`   ${label} : ${valeur}`);
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

const CLIENT = { clientId: "essai.apps.googleusercontent.com", clientSecret: "secret-essai" };
const google = await demarrerFauxGoogle(GOOGLE, { ...CLIENT, courriel: "eleve@exemple.fr" });

// --- Le serveur, configuré pour le faux Google ------------------------------
const serveur = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: RACINE,
  env: {
    ...process.env,
    DATABASE_URL: `file:${path.resolve("verif.db")}`,
    UPLOAD_DIR: path.resolve("uploads"),
    GOOGLE_CLIENT_ID: CLIENT.clientId,
    GOOGLE_CLIENT_SECRET: CLIENT.clientSecret,
    GOOGLE_REDIRECT_URI: `${BASE}/api/google-drive/retour`,
    GOOGLE_ENDPOINT_BASE: `http://localhost:${GOOGLE}`,
    GOOGLE_BACKOFF_MS: "40",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let journalServeur = "";
serveur.stdout.on("data", (d) => (journalServeur += d));
serveur.stderr.on("data", (d) => (journalServeur += d));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/login`)).ok) break;
  } catch {}
  await attendre(500);
}

const userId = sql("select id from User where email = (select email from User order by createdAt limit 1);");

// --- Des données à sauvegarder, posées en base -------------------------------
const marque = `drive${Date.now()}`;
const dossierId = `${marque}d`;
const noteId = `${marque}n`;
const photo = `${randomUUID()}.png`;
copyFileSync("photo.png", path.join("uploads", photo));
const dessin = JSON.stringify({
  ratio: 0.75,
  paper: "blank",
  pages: [{ image: photo, ratio: 0.75 }],
  strokes: [{ color: "ink", size: 2, tool: "pen", points: [0.1, 0.1, 0.5, 0.3, 0.2, 0.6, 0.5, 0.25, 0.4] }],
});
const texte = JSON.stringify({ style: "p", markup: `La **mitose** ${marque}` });
const esc = (s) => s.replace(/'/g, "''");
sql(`insert into Folder (id, ownerId, parentId, kind, name, color, createdAt, updatedAt)
     values ('${dossierId}', '${userId}', null, 'note', 'Biologie ${marque}', 'slate', datetime('now'), datetime('now'));`);
sql(`insert into Note (id, ownerId, folderId, title, searchText, preview, mastered, createdAt, updatedAt)
     values ('${noteId}', '${userId}', '${dossierId}', 'Cours de bio', '', '', 0, datetime('now'), datetime('now'));`);
sql(`insert into NoteBlock (id, noteId, kind, position, content) values
     ('${marque}b1', '${noteId}', 'text', 0, '${esc(texte)}'),
     ('${marque}b2', '${noteId}', 'drawing', 1, '${esc(dessin)}');`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 180));
  ko++;
});

const vivants = () => [...google.fichiers.values()].filter((f) => !google.aLaCorbeille(f));
const parChemin = (fin) => vivants().find((f) => google.chemin(f).endsWith(fin));
const derniere = () => sql(`select coalesce(lastSyncAt, '') || '|' || lastStatus from DriveLink where userId = '${userId}';`);

/** Attend la fin d'une passe : la date de la dernière passe change. */
async function passeFinie(avant, ms = 60000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const maintenant = derniere();
    if (maintenant && maintenant !== avant && !maintenant.startsWith("|")) return maintenant;
    await attendre(250);
  }
  return null;
}

async function sauvegarder() {
  const avant = derniere();
  await page.goto(`${BASE}/sauvegarde`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sauvegarder maintenant" }).click();
  return passeFinie(avant);
}

try {
  // ===========================================================================
  section("liaison");
  sql(`delete from DriveItem where userId = '${userId}'; delete from DriveLink where userId = '${userId}';`);
  await page.goto(`${BASE}/sauvegarde`, { waitUntil: "networkidle" });
  const relier = page.getByRole("link", { name: "Relier Google Drive" });
  check(await relier.isVisible(), "la page propose de relier Google Drive");
  await page.screenshot({ path: "shots/sauvegarde-a-relier.png" });

  const avantLiaison = derniere();
  await relier.click();
  await page.waitForURL(/\/sauvegarde\?drive=/);
  check(page.url().endsWith("drive=relie"), "le retour de Google mène à « relié »", page.url());
  check(!page.url().includes("code="), "et l'adresse finale ne porte plus le code");
  const demande = google.journal.autorisations.at(-1) ?? {};
  check(demande.scope === "https://www.googleapis.com/auth/drive.file", "la seule portée demandée est drive.file", demande.scope);
  check(demande.access_type === "offline" && demande.prompt === "consent", "hors ligne, avec consentement");
  check(demande.code_challenge_method === "S256" && (demande.state ?? "").length >= 20, "PKCE S256 et un state");
  const echange = google.journal.echanges.at(-1) ?? {};
  check(echange.pkce && echange.retourIdentique, "le code est échangé avec le vérificateur et la même adresse de retour");
  const scelle = sql(`select refreshToken from DriveLink where userId = '${userId}';`);
  check(scelle.startsWith("v1:") && !scelle.includes("1//"), "le jeton est chiffré en base");
  check(await page.getByText("eleve@exemple.fr").isVisible(), "la page dit quel compte est relié");

  // ===========================================================================
  section("première passe");
  const premiere = await passeFinie(avantLiaison);
  check(premiere?.endsWith("|ok"), "la première passe se termine sans erreur", premiere ?? journalServeur.slice(-400));
  const racine = vivants().find((f) => f.name === "Fiches" && f.parents.length === 0);
  check(Boolean(racine), "un dossier « Fiches » à la racine du Drive");
  const pdf = parChemin(`Notes/Biologie ${marque}/Cours de bio.pdf`);
  check(pdf?.contenu?.subarray(0, 5).toString() === "%PDF-", "la note annotée, en PDF, rangée dans son dossier", pdf ? google.chemin(pdf) : "absente");
  const md = parChemin(`Notes/Biologie ${marque}/Cours de bio.md`);
  check(md?.contenu?.toString().includes(`La **mitose** ${marque}`), "son texte en Markdown, à côté");
  const paquets = parChemin("Données/Paquets.json");
  let sauvegarde = null;
  try {
    sauvegarde = JSON.parse(paquets?.contenu?.toString() ?? "null");
  } catch {}
  check(sauvegarde?.app === "fiches" && Array.isArray(sauvegarde?.decks), "les paquets, au format de « Sauvegarde complète »");
  check(Boolean(parChemin(`Données/Notes/${noteId}.json`)), "la note brute, de quoi la restaurer");
  const image = parChemin(`Données/Fichiers/${photo}`);
  check(
    image?.contenu?.equals(readFileSync(path.join("uploads", photo))),
    "la photo d'origine, octet pour octet",
  );
  check(Boolean(parChemin("Fiches/LISEZMOI.txt")), "et un LISEZMOI qui explique tout cela");
  check(
    vivants().every((f) => f.appProperties.fichesCompte === userId && f.appProperties.fichesCle),
    "chaque fichier porte ses étiquettes",
  );
  dire("déposés", `${vivants().length} éléments, ${google.journal.envois} envois`);

  // ===========================================================================
  section("passes suivantes");
  let envois = google.journal.envois;
  check((await sauvegarder())?.endsWith("|ok"), "une passe sans changement se termine");
  check(google.journal.envois === envois, "et n'envoie rien", `${google.journal.envois - envois} envois`);

  sql(`update Note set title = 'Cours de bio — mitose', updatedAt = datetime('now', '+1 second') where id = '${noteId}';`);
  envois = google.journal.envois;
  const idAvant = pdf?.id;
  const versionsAvant = pdf?.versions ?? 0;
  check((await sauvegarder())?.endsWith("|ok"), "une note modifiée se sauvegarde");
  const renomme = parChemin(`Biologie ${marque}/Cours de bio — mitose.pdf`);
  check(renomme?.id === idAvant && renomme?.versions === versionsAvant + 1, "sur place : même fichier, une version de plus", renomme ? `${renomme.versions} versions` : "introuvable");
  dire("envois pour une note modifiée", google.journal.envois - envois);
  check(google.journal.envois - envois <= 4, "et seule elle repart (PDF, Markdown, note brute, paquets au plus)");

  sql(`update Note set folderId = null, updatedAt = datetime('now', '+2 second') where id = '${noteId}';`);
  check((await sauvegarder())?.endsWith("|ok"), "une note rangée ailleurs se sauvegarde");
  check(Boolean(parChemin("Fiches/Notes/Cours de bio — mitose.pdf")), "et se retrouve à sa nouvelle place");

  // ===========================================================================
  section("pannes et pertes");
  google.panne(3, 503);
  check((await sauvegarder())?.endsWith("|ok"), "trois 503 de suite sont absorbés par la reprise");

  const avantPerte = vivants().length;
  sql(`delete from DriveItem where userId = '${userId}';`);
  check((await sauvegarder())?.endsWith("|ok"), "la table de correspondance perdue, la passe se termine");
  check(vivants().length === avantPerte, "sans un seul doublon : les étiquettes ont tout retrouvé", `${avantPerte} → ${vivants().length}`);

  google.fichiers.get(racine.id).trashed = true;
  check((await sauvegarder())?.endsWith("|ok"), "le dossier « Fiches » mis à la corbeille, la passe se termine");
  const refaite = vivants().find((f) => f.name === "Fiches" && f.parents.length === 0);
  check(refaite && refaite.id !== racine.id, "et la sauvegarde est refaite à neuf");
  check(Boolean(parChemin("Fiches/Notes/Cours de bio — mitose.pdf")), "complète");

  sql(`delete from Note where id = '${noteId}';`);
  check((await sauvegarder())?.endsWith("|ok"), "une note supprimée se sauvegarde aussi");
  check(!parChemin("Cours de bio — mitose.pdf"), "son PDF part à la corbeille");
  check(
    [...google.fichiers.values()].some((f) => f.name === "Cours de bio — mitose.pdf" && f.trashed),
    "à la corbeille, pas effacé : on peut encore le reprendre",
  );

  // ===========================================================================
  section("la page, dans ses états reliés");
  for (const [nom, vp, sombre] of [
    ["téléphone clair", { width: 393, height: 852 }, false],
    ["téléphone sombre", { width: 393, height: 852 }, true],
    ["desktop clair", { width: 1280, height: 800 }, false],
    ["desktop sombre", { width: 1280, height: 800 }, true],
  ]) {
    const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: sombre ? "dark" : "light" });
    await c.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
    const p = await c.newPage();
    await p.goto(`${BASE}/sauvegarde`, { waitUntil: "networkidle" });
    await p.waitForTimeout(300);
    const contraste = await p.evaluate(CONTRAST);
    const cibles = await p.evaluate(TOUCH);
    const positions = await p.evaluate(POSITION);
    const deborde = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(
      contraste.length === 0 && cibles.length === 0 && positions.length === 0 && !deborde,
      `reliée, ${nom} : contraste, 44 px, positions, débordement`,
      JSON.stringify({ contraste, cibles, positions, deborde }).slice(0, 300),
    );
    await p.screenshot({ path: `shots/sauvegarde-reliee-${nom.replace(" ", "-")}.png`, fullPage: true });
    await c.close();
  }

  // ===========================================================================
  section("accès retiré, puis délier");
  google.revoquerTout();
  const apresRevocation = await sauvegarder();
  check(apresRevocation?.endsWith("|reconnect"), "un accès retiré chez Google se dit « à relier »", apresRevocation ?? "");
  await page.goto(`${BASE}/sauvegarde`, { waitUntil: "networkidle" });
  check(await page.getByText("À relier").isVisible(), "la page l'affiche");
  check(await page.getByRole("link", { name: "Relier à nouveau" }).isVisible(), "et propose de relier à nouveau");
  await page.screenshot({ path: "shots/sauvegarde-reconnecter.png" });

  const avantRelier = derniere();
  await page.getByRole("link", { name: "Relier à nouveau" }).click();
  await page.waitForURL(/drive=relie/);
  check((await passeFinie(avantRelier))?.endsWith("|ok"), "relié à nouveau, la sauvegarde repart");
  const avantDeliaison = vivants().length;
  const revocations = google.journal.revocations.length;
  await page.getByRole("button", { name: "Délier" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Délier" }).click();
  await page.waitForTimeout(1200);
  check(google.journal.revocations.length === revocations + 1, "délier révoque le jeton chez Google");
  check(sql(`select count(*) from DriveLink where userId = '${userId}';`) === "0", "et l'oublie ici");
  check(vivants().length === avantDeliaison, "les fichiers restent dans le Drive");
  check(await page.getByRole("link", { name: "Relier Google Drive" }).isVisible(), "la page propose de relier à nouveau");
} finally {
  // Ménage : rien d'essai ne reste dans la base de vérification.
  sql(`delete from Note where id = '${noteId}'; delete from Folder where id = '${dossierId}';
       delete from DriveItem where userId = '${userId}'; delete from DriveLink where userId = '${userId}';`);
  execFileSync("rm", ["-f", path.join("uploads", photo)]);
  await browser.close();
  serveur.kill();
  await google.fermer();
}

if (ko > 0 && journalServeur) console.log("\n— serveur —\n" + journalServeur.slice(-1500));
console.log(ko === 0 ? "\nSauvegarde Google Drive : tout passe." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
