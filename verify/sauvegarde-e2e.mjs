/*
 * Ce qui est écrit ne se perd pas — même quand l'enregistrement ne passe plus.
 *
 * Le défaut d'origine : une modification était envoyée une fois. Si l'envoi
 * échouait — réseau coupé, session expirée, serveur redémarré — un message
 * s'affichait et le contenu ne vivait plus que dans la mémoire de l'onglet.
 * Recharger, changer d'application sur iPad, laisser le système évincer la
 * page : le travail partait, et rien ne le rejouait jamais.
 *
 * Ce script éprouve l'invariant qui remplace cela : **rien ne part au réseau
 * avant d'être posé sur l'appareil, et rien n'en sort avant que le serveur
 * n'ait confirmé**. On coupe donc l'enregistrement pour de vrai, on écrit, on
 * recharge, et l'encre doit être là.
 */
import { chromium } from "playwright";
import { readFileSync, rmSync, existsSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 160));
  echecs++;
});

const TITRE = `Sauvegarde ${Date.now()}`;

// --- Outils -----------------------------------------------------------------

const canvas = () => page.locator('[data-testid="drawing-canvas"]').last();
const traits = async () =>
  Number((await canvas().getAttribute("aria-label"))?.match(/(\d+) trait/)?.[1] ?? 0);

/** Un geste au stylet, en fractions de la largeur de la page. */
async function geste(points) {
  await canvas().evaluate(async (el, pts) => {
    const r = el.getBoundingClientRect();
    const fire = (t, [x, y], p, b) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
          pressure: p, buttons: b, clientX: r.left + r.width * x, clientY: r.top + r.width * y,
        }),
      );
    fire("pointerdown", pts[0], 0.5, 1);
    for (let i = 1; i < pts.length; i++) {
      fire("pointermove", pts[i], 0.45 + Math.sin(i) * 0.1, 1);
      if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", pts.at(-1), 0, 0);
  }, points);
  await page.waitForTimeout(150);
}
const ligne = (y) => Array.from({ length: 20 }, (_, i) => [0.15 + i * 0.03, y + (i % 2) * 0.003]);

/** Ce que la base contient réellement pour cette note, vu du serveur. */
async function traitsEnBase(url) {
  const html = await page.evaluate(async (u) => {
    const r = await fetch(u, { cache: "no-store" });
    return r.status === 200 ? await r.text() : `STATUT ${r.status}`;
  }, url);
  // Le contenu des blocs part dans la charge utile du rendu serveur.
  return (html.match(/\\"points\\":/g) ?? html.match(/"points":/g) ?? []).length;
}

const pastille = () => page.locator('[data-testid="etat-sauvegarde"]');

// --- 1. Une note, trois traits, tout va bien --------------------------------

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).first().click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const url = page.url();
await page.getByLabel("Titre de la note").fill(TITRE);
await page.getByLabel("Titre de la note").blur();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);

await page.getByRole("button", { name: "Stylo" }).click();
await geste(ligne(0.1));
await geste(ligne(0.16));
await geste(ligne(0.22));
await page.waitForTimeout(1600);
check((await traits()) === 3, "trois traits sur la page", `${await traits()}`);
check(
  (await pastille().textContent())?.includes("Enregistré"),
  "la pastille confirme l'enregistrement",
  await pastille().textContent(),
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
check((await traits()) === 3, "et ils sont bien en base après rechargement", `${await traits()}`);

try {

// --- 2. L'enregistrement casse : on écrit quand même ------------------------

let coupe = true;
await page.route("**/api/notes/*/blocks/*", (route) => {
  if (coupe) return route.abort("failed");
  return route.fallback();
});

await page.getByRole("button", { name: "Stylo" }).click();
await geste(ligne(0.3));
await geste(ligne(0.36));
await page.waitForTimeout(2500);

check((await traits()) === 5, "deux traits de plus à l'écran", `${await traits()}`);
const texteEnPanne = (await pastille().textContent()) ?? "";
check(
  /Hors ligne|Reprise|Non enregistré/.test(texteEnPanne),
  "la pastille nomme la panne au lieu de rester sur « Enregistrement… »",
  texteEnPanne,
);
// Les deux traits sont sur la **même** page : la file garde une entrée par
// bloc, pas par geste — c'est le dernier état de chacun qui compte.
check(/1$/.test(texteEnPanne.trim()), "et compte les blocs qui attendent", texteEnPanne);

// Le serveur, lui, n'a rien reçu : c'est bien une vraie panne qu'on éprouve.
check((await traitsEnBase(url)) === 3, "le serveur n'a effectivement rien reçu");

// --- 2 bis. Changer d'application en plein mot ------------------------------

/*
 * L'enregistrement est différé de 700 ms. Passer à une autre application sur
 * iPad, ou verrouiller l'écran, laissait ces 700 ms dans le vide : le système
 * gèle puis évince l'onglet, et le démontage React — seul déclencheur d'une
 * vidange forcée — n'arrive jamais. `visibilitychange`, lui, arrive avant le
 * gel.
 */
/** Ce que le journal porte réellement sur le disque, lu dans IndexedDB. */
async function traitsAuJournal() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const d = indexedDB.open("fiches-brouillons", 1);
        d.onerror = () => resolve(-1);
        d.onsuccess = () => {
          const tx = d.result.transaction("brouillons", "readonly");
          const tout = tx.objectStore("brouillons").getAll();
          tout.onsuccess = () => {
            const b = tout.result.at(-1);
            resolve(b ? (b.content.match(/"points":/g) ?? []).length : 0);
          };
          tx.onerror = () => resolve(-1);
        };
      }),
  );
}

const auJournalAvant = await traitsAuJournal();
check(auJournalAvant === 5, "le journal porte les cinq traits", `${auJournalAvant}`);

await geste(ligne(0.42));
// Le trait est posé ; le délai d'enregistrement (700 ms) n'est pas écoulé.
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(250);
const auJournalApres = await traitsAuJournal();
check(
  auJournalApres === 6,
  "l'onglet qui part à l'arrière-plan pose le trait sur le disque AVANT le délai",
  `${auJournalApres} trait(s) au journal à 250 ms — sans la vidange forcée il y en aurait 5`,
);
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});

// --- 3. Le cœur : recharger pendant la panne ne perd rien -------------------

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check(
  (await traits()) === 6,
  "RECHARGEMENT EN PLEINE PANNE : les traits non enregistrés sont revenus",
  `${await traits()} trait(s) — ils étaient perdus avant`,
);
check(
  await page.getByRole("status").filter({ hasText: /retrouvée|retrouvées/ }).isVisible(),
  "et l'app dit qu'elle les a retrouvés",
);

// --- 4. La trappe manuelle : emporter son travail dans un fichier -----------

await pastille().click();
await page.getByRole("dialog").waitFor();
const telechargement = page.waitForEvent("download");
await page.getByRole("button", { name: "Télécharger une sauvegarde" }).click();
const fichier = await telechargement;
const chemin = `/tmp/${fichier.suggestedFilename()}`;
await fichier.saveAs(chemin);
const sauvegarde = JSON.parse(readFileSync(chemin, "utf8"));
check(
  sauvegarde.format === "brouillons-v1" && sauvegarde.brouillons.length >= 1,
  "le fichier de secours contient les brouillons",
  `${sauvegarde.brouillons?.length} entrée(s)`,
);
check(
  (sauvegarde.brouillons[0].content.match(/"points":/g) ?? []).length === 6,
  "avec les six traits dedans",
);
if (existsSync(chemin)) rmSync(chemin);

// --- 5. Le réseau revient : la file repart toute seule ----------------------

coupe = false;
await page.getByRole("button", { name: "Réessayer maintenant" }).click();
await page.waitForTimeout(1500);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check(
  (await pastille().textContent())?.includes("Enregistré"),
  "la pastille repasse au vert",
  await pastille().textContent(),
);
check((await traitsEnBase(url)) === 6, "et le serveur a bien reçu les six traits");

// --- 6. Hors ligne pour de vrai, puis retour du réseau ----------------------

await page.getByRole("button", { name: "Stylo" }).click();
await ctx.setOffline(true);
await geste(ligne(0.48));
await page.waitForTimeout(2200);
check(
  (await pastille().textContent())?.includes("Hors ligne"),
  "coupure réseau réelle : la pastille dit « Hors ligne »",
  await pastille().textContent(),
);

await ctx.setOffline(false);
// Aucun clic : c'est l'événement `online` qui doit réveiller la file.
await page.waitForTimeout(2500);
check(
  (await pastille().textContent())?.includes("Enregistré"),
  "le retour du réseau relance l'envoi sans rien demander",
  await pastille().textContent(),
);
check((await traitsEnBase(url)) === 7, "le septième trait est en base");

// --- 7. Session expirée : dite, et jamais confondue avec un succès ---------

await page.route("**/api/notes/*/blocks/*", (route) =>
  route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Session expirée."}' }),
);
await geste(ligne(0.52));
await page.waitForTimeout(2200);
const texteSession = (await pastille().textContent()) ?? "";
check(texteSession.includes("Session expirée"), "un 401 se dit tel quel", texteSession);
check((await traitsEnBase(url)) === 7, "et rien n'est annoncé comme enregistré");

// Le piège classique : une passerelle qui redirige vers /login au lieu de 401.
// Suivie, la redirection rend un 200 et la page de connexion — l'app croirait
// avoir enregistré sa page dans un écran de login.
await page.route("**/api/notes/*/blocks/*", (route) =>
  route.fulfill({ status: 307, headers: { location: "/login" } }),
);
await geste(ligne(0.58));
await page.waitForTimeout(2200);
check(
  ((await pastille().textContent()) ?? "").includes("Session expirée"),
  "une redirection vers /login n'est pas prise pour un enregistrement",
  await pastille().textContent(),
);

} catch (cause) {
  // Un script qui meurt en chemin laisserait sa note d'essai derrière lui.
  console.log(`❌ le script s'est interrompu — ${String(cause).slice(0, 200)}`);
  echecs++;
} finally {
  await page.unroute("**/api/notes/*/blocks/*").catch(() => {});
}

// --- 8. Un brouillon plus ancien que la note ne s'impose pas ----------------

/*
 * Le brouillon a été écrit ici, mais la note a été modifiée **depuis**, peut-être
 * depuis un autre appareil. Le remettre d'office écraserait ce travail-là. On
 * pose donc un brouillon daté d'hier et l'on vérifie que l'app demande au lieu
 * de trancher.
 *
 * Cet état n'apparaît que sous condition : sans scénario dédié, il n'est jamais
 * regardé.
 */
const blocId = await page.evaluate(() =>
  document.querySelector("[id^='bloc-']")?.id.replace("bloc-", "") ?? null,
);
check(blocId !== null, "un bloc à viser pour le litige");

await page.evaluate(
  ([id, note]) =>
    new Promise((resolve) => {
      const d = indexedDB.open("fiches-brouillons", 1);
      d.onsuccess = () => {
        const tx = d.result.transaction("brouillons", "readwrite");
        tx.objectStore("brouillons").put({
          blockId: id,
          noteId: note,
          kind: "drawing",
          content: JSON.stringify({ ratio: 1.414, strokes: [], pages: [] }),
          // Hier : forcément antérieur au dernier enregistrement de la note.
          seq: Date.now() - 24 * 3600 * 1000,
        });
        tx.oncomplete = () => resolve(true);
      };
    }),
  [blocId, url.split("/").pop()],
);

// Le faux brouillon est **vide** et remplace l'entrée du bloc dans le journal :
// s'il s'imposait, la page reviendrait sans aucun trait. Le repère est donc ce
// que porte le serveur, pas ce qui est à l'écran.
const enBase = await traitsEnBase(url);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check(
  (await traits()) === enBase && enBase > 0,
  "un brouillon plus ancien que la note ne l'écrase pas",
  `${await traits()} à l'écran pour ${enBase} en base`,
);
// Le choix se pose **dans la note**, pas derrière la pastille : celle-ci est
// masquée quand tout est enregistré, ce qui est le cas ici — ces brouillons
// n'attendent pas un envoi mais une décision.
check(
  await page.getByText("Versions retrouvées sur cet appareil").isVisible(),
  "il est proposé à l'écran, pas imposé ni caché",
);
// À ouvrir : la mesure dit qu'il est là, pas qu'il se lit.
await page.screenshot({ path: "shots/sauvegarde-litige.png", clip: { x: 0, y: 0, width: 1194, height: 460 } });
await page.getByRole("button", { name: "Jeter" }).first().click();
await page.waitForTimeout(600);
check(
  (await page.getByText("Versions retrouvées sur cet appareil").count()) === 0,
  "« Jeter » le retire pour de bon",
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
check(
  (await page.getByText("Versions retrouvées sur cet appareil").count()) === 0,
  "et il ne revient pas au rechargement",
);

// --- Ménage -----------------------------------------------------------------

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
const carte = page.locator(`text=${TITRE}`).first();
if (await carte.count()) {
  await carte.click({ button: "right" });
  const supprimer = page.getByRole("menuitem", { name: /Supprimer/ });
  if (await supprimer.count()) {
    await supprimer.click();
    const confirmer = page.getByRole("button", { name: "Supprimer", exact: true });
    if (await confirmer.count()) await confirmer.click();
    await page.waitForTimeout(800);
  }
}
check(
  (await page.locator(`text=${TITRE}`).count()) === 0,
  "la note d'essai ne reste pas dans la base",
);

await browser.close();
console.log(echecs === 0 ? "\n✅ tout passe" : `\n❌ ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
