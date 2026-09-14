/*
 * Pages ajoutées dans un document importé, et fonds de page.
 *
 * Le geste : le cours déborde, on glisse une feuille dans le polycopié. Comme
 * dans les applications dédiées, la feuille se pose **après la page qu'on
 * regarde**, elle reprend le fond de sa voisine, et l'on en change d'un geste.
 *
 * Tout le risque est dans le décalage. Les traits sont repérés d'un bout à
 * l'autre de la pile — c'est ce qui permet d'annoter à cheval sur deux pages —
 * donc glisser une feuille au milieu doit faire **descendre avec leur page**
 * toutes les annotations qui suivent. Si on l'oublie, chacune tombe sur la page
 * d'à côté, et rien à l'écran ne dit pourquoi. C'est ce que ce script mesure :
 * pour chaque tache d'encre, sur quelle page elle se trouve, avant et après.
 *
 * Les fonds, ensuite : la bonne classe sur la bonne page, un interligne qui
 * suit la largeur — donc le zoom — et des lignes qui se retrouvent **dans le
 * PDF exporté**, où elles manquaient complètement.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

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
const ctx = await browser.newContext({
  viewport: { width: 1194, height: 900 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 180));
  ko++;
});

/** Trace un trait au stylet, en coordonnées de **surface** (fraction de largeur). */
const tracer = (points) =>
  page.evaluate(async ({ points }) => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const scroller = el.closest("[data-ink-scroll]");
    const feuille = scroller.firstElementChild;
    const largeur = feuille.getBoundingClientRect().width;
    // Le trait est donné dans la pile : on amène d'abord la zone à l'écran.
    scroller.scrollTop = Math.max(0, points[0][1] * largeur - scroller.clientHeight / 2);
    await new Promise((r) => requestAnimationFrame(r));

    const r = feuille.getBoundingClientRect();
    const fire = (type, x, y, p, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
          isPrimary: true, pressure: p, buttons,
          clientX: r.left + largeur * x, clientY: r.top + largeur * y,
        }),
      );
    fire("pointerdown", points[0][0], points[0][1], 0.8, 1);
    for (let i = 1; i < points.length; i++) {
      fire("pointermove", points[i][0], points[i][1], 0.8, 1);
      if (i % 3 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
    fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
    await new Promise((r) => requestAnimationFrame(r));
  }, { points });

/** Une ligne horizontale de vingt points, à la hauteur `y` de la pile. */
const ligne = (y) => Array.from({ length: 20 }, (_, i) => [0.15 + (i * 0.6) / 19, y]);

/**
 * Amène la page `index` sous les yeux.
 *
 * La palette parle de **la page qu'on regarde** : son fond, la feuille qu'on
 * glisse après elle, celle qu'on retire. Sans cela, tout geste s'applique à la
 * page où le défilement se trouvait — et remettre la vue à zéro, ce que fait le
 * bouton du zoom, ramène sur la première page du document, où il n'y a plus ni
 * fond à choisir ni page à retirer.
 */
const allerPage = async (index) => {
  const { largeur, bandes: liste } = await bandes();
  const cible = liste[index];
  if (!cible) return;
  await page.evaluate(
    ({ y }) => {
      const s = document.querySelector("[data-ink-scroll]");
      // Le milieu de la page au milieu de la fenêtre : c'est la règle qui
      // décide de la page courante.
      s.scrollTop = Math.max(0, y - s.clientHeight / 2);
    },
    { y: (cible.top + cible.ratio / 2) * largeur },
  );
  await page.waitForTimeout(500);
};

/**
 * Les pages de la surface, telles qu'elles sont posées.
 *
 * Elles viennent du DOM : chaque page est un bloc placé dans la pile, avec sa
 * classe de fond et son interligne calculé.
 */
const bandes = () =>
  page.evaluate(() => {
    const scroller = document.querySelector("[data-ink-scroll]");
    const feuille = scroller.firstElementChild;
    const r = feuille.getBoundingClientRect();
    return {
      largeur: r.width,
      bandes: [...feuille.children]
        .filter((el) => el.matches("div[aria-hidden]") && !el.hasAttribute("data-ink-tiles"))
        .map((el) => {
          const b = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return {
            top: (b.top - r.top) / r.width,
            ratio: b.height / r.width,
            classe: el.className,
            fond: st.backgroundImage === "none" ? null : "dessiné",
            pas: st.getPropertyValue("--paper-step").trim(),
            document: el.querySelector("canvas") !== null,
          };
        }),
    };
  });

/**
 * Où se trouve l'encre dans la pile, en fraction de la largeur.
 *
 * Il faut **balayer** toute la surface : seules les tuiles proches de l'écran
 * sont peintes — c'est ce qui permet à un polycopié de deux cents pages de
 * tenir en mémoire — et lire les tuiles montées à un instant donné ne montre
 * qu'une fenêtre. La première mesure de ce script l'ignorait et ne voyait
 * qu'une annotation sur deux : elle accusait l'application d'avoir perdu
 * l'autre.
 */
const encre = async () => {
  const taille = await page.evaluate(() => {
    const s = document.querySelector("[data-ink-scroll]");
    return { hauteur: s.scrollHeight, fenetre: s.clientHeight, depart: s.scrollTop };
  });

  const hauteurs = new Set();
  for (let top = 0; top < taille.hauteur; top += taille.fenetre * 0.5) {
    await page.evaluate((t) => {
      document.querySelector("[data-ink-scroll]").scrollTop = t;
    }, top);
    await page.waitForTimeout(280);
    for (const y of await page.evaluate(() => {
      const feuille = document.querySelector("[data-ink-scroll]").firstElementChild;
      const largeur = feuille.getBoundingClientRect().width;
      const trouves = [];
      for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
        const ctx = c.getContext("2d");
        if (!ctx || c.width === 0) continue;
        const dessus = parseFloat(c.style.top) || 0;
        const echelle = c.height / parseFloat(c.style.height);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        for (let py = 0; py < c.height; py++) {
          let tache = false;
          for (let px = 0; px < c.width && !tache; px++) {
            if (data[(py * c.width + px) * 4 + 3] > 8) tache = true;
          }
          if (tache) trouves.push(Number(((dessus + py / echelle) / largeur).toFixed(4)));
        }
      }
      return trouves;
    })) {
      hauteurs.add(y);
    }
  }
  // On remet le défilement là où on l'avait pris : la page courante décide de
  // ce que propose la palette, et la déplacer fausserait la suite.
  await page.evaluate((t) => {
    document.querySelector("[data-ink-scroll]").scrollTop = t;
  }, taille.depart);
  await page.waitForTimeout(300);
  return [...hauteurs].sort((a, b) => a - b);
};

/** L'état complet : les pages, et sur laquelle tombe chaque tache d'encre. */
const etatPages = async () => {
  const { largeur, bandes: liste } = await bandes();
  const hauteurs = await encre();

  // Regroupées en taches : une ligne tracée fait quelques pixels de haut.
  const taches = [];
  for (const y of hauteurs) {
    const derniere = taches.at(-1);
    if (derniere && y - derniere.max < 0.02) derniere.max = y;
    else taches.push({ min: y, max: y });
  }

  const pageDe = (y) => {
    for (let i = 0; i < liste.length; i++) {
      if (y < liste[i].top + liste[i].ratio) return i;
    }
    return liste.length - 1;
  };

  return {
    largeur,
    bandes: liste,
    taches: taches.map((t) => ({
      y: Number(((t.min + t.max) / 2).toFixed(4)),
      page: pageDe((t.min + t.max) / 2),
    })),
  };
};

// --- Préparation : un document de deux pages, annoté sur chacune -------------
section("préparation");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
const noteId = page.url().split("/").pop();
await page.getByLabel("Titre de la note").fill(`Fonds ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles("doc-test.pdf");
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.getByRole("button", { name: "Document" }).waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);

const depart = await etatPages();
dire("pages du document", depart.bandes.length);
check(depart.bandes.length === 2, "le document a ses deux pages", String(depart.bandes.length));
check(
  depart.bandes.every((b) => b.document),
  "et chacune montre son image",
);

// Une annotation au milieu de chaque page.
await tracer(ligne(depart.bandes[0].top + depart.bandes[0].ratio / 2));
await page.waitForTimeout(1200);
await tracer(ligne(depart.bandes[1].top + depart.bandes[1].ratio / 2));
await page.waitForTimeout(1400);

const annote = await etatPages();
dire("taches d'encre", JSON.stringify(annote.taches));
check(
  annote.taches.length === 2 && annote.taches[0].page === 0 && annote.taches[1].page === 1,
  "une annotation sur chaque page",
  JSON.stringify(annote.taches),
);

// --- Ajouter une page --------------------------------------------------------
section("ajouter une page");

// On se place sur la première page : la feuille se glisse après celle qu'on
// regarde, comme dans les applications dédiées.
await page.evaluate(() => {
  document.querySelector("[data-ink-scroll]").scrollTop = 0;
});
await page.waitForTimeout(700);

const ajouter = page.getByRole("button", { name: "Ajouter une page après celle-ci" });
check(await ajouter.isVisible(), "la palette propose d'ajouter une page");
await ajouter.click();
await page.waitForTimeout(1600);

const apres = await etatPages();
dire("pages", apres.bandes.length);
dire("taches d'encre", JSON.stringify(apres.taches));
check(apres.bandes.length === 3, "la pile compte une page de plus", String(apres.bandes.length));
check(!apres.bandes[1].document, "la nouvelle page est au rang 2, et n'a pas d'image");
check(
  apres.bandes[1].ratio.toFixed(2) === depart.bandes[0].ratio.toFixed(2),
  "elle a le format de sa voisine",
  `${apres.bandes[1].ratio.toFixed(3)} pour ${depart.bandes[0].ratio.toFixed(3)}`,
);

/*
 * La vérification qui compte.
 *
 * L'annotation de l'ancienne page 2 doit se retrouver sur la page 3 — elle a
 * suivi sa page. Sans le décalage des traits, elle serait restée sur la
 * nouvelle page vierge.
 */
check(
  apres.taches.length === 2 && apres.taches[0].page === 0 && apres.taches[1].page === 2,
  "chaque annotation est restée sur sa page",
  JSON.stringify(apres.taches),
);
check(
  apres.taches[1].y > annote.taches[1].y,
  "elle est bien descendue dans la pile, pas restée en place",
  `${annote.taches[1].y} → ${apres.taches[1].y}`,
);

// --- Les quatre fonds --------------------------------------------------------
section("les quatre fonds");

const FONDS = [
  ["Lignes", "paper-ruled", 7 / 210],
  ["Carreaux", "paper-grid", 5 / 210],
  ["Points", "paper-dots", 5 / 210],
  ["Uni", "", 0],
];

for (const [nom, classe, fraction] of FONDS) {
  await allerPage(1);
  await page.getByRole("button", { name: nom, exact: true }).click();
  await page.waitForTimeout(900);
  const etat = await bandes();
  const bande = etat.bandes[1];

  if (classe) {
    check(bande.classe.includes(classe), `« ${nom} » pose ${classe} sur la page ajoutée`, bande.classe);
    check(bande.fond === "dessiné", `et le fond est réellement dessiné`, String(bande.fond));
    // L'interligne suit la largeur de la page : c'est ce qui le fait grossir
    // avec le zoom au lieu de resserrer les lignes.
    const attendu = etat.largeur * fraction;
    const mesure = parseFloat(bande.pas);
    check(
      Math.abs(mesure - attendu) < 1,
      `l'interligne vaut ${fraction === 7 / 210 ? "7" : "5"} mm sur une page A4`,
      `${mesure.toFixed(1)} px pour ${attendu.toFixed(1)} attendus`,
    );
  } else {
    check(!bande.classe.includes("paper-"), "« Uni » n'en pose aucun", bande.classe);
    check(bande.fond === null, "et ne dessine rien");
  }

  // Le fond appartient à **cette** page : les pages du document n'y touchent pas.
  check(
    etat.bandes.filter((b) => /paper-(ruled|grid|dots)/.test(b.classe)).length === (classe ? 1 : 0),
    "le fond ne déborde pas sur les pages voisines",
    etat.bandes.map((b) => b.classe.match(/paper-\w+/)?.[0] ?? "—").join(", "),
  );
}

// On repose des lignes pour la suite : c'est le fond le plus courant.
await allerPage(1);
await page.getByRole("button", { name: "Lignes", exact: true }).click();
await page.waitForTimeout(1000);

// --- L'interligne suit le zoom ----------------------------------------------
section("interligne et zoom");
await allerPage(1);
const pasAvant = (await bandes()).bandes[1].pas;
await page.evaluate(async () => {
  const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + 200;
  const fire = (t, id, x, y, b) =>
    el.dispatchEvent(
      new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
        isPrimary: id === 1, pressure: 0.5, buttons: b, clientX: x, clientY: y,
      }),
    );
  fire("pointerdown", 1, cx - 40, cy, 1);
  fire("pointerdown", 2, cx + 40, cy, 1);
  for (let i = 1; i <= 12; i++) {
    const d = 40 + (200 - 40) * (i / 12);
    fire("pointermove", 1, cx - d, cy, 1);
    fire("pointermove", 2, cx + d, cy, 1);
    await new Promise((r) => requestAnimationFrame(r));
  }
  fire("pointerup", 1, cx - 200, cy, 0);
  fire("pointerup", 2, cx + 200, cy, 0);
});
await page.waitForTimeout(900);
const zoome = await bandes();
const pasApres = zoome.bandes[1].pas;
const facteur = parseFloat(pasApres) / parseFloat(pasAvant);
dire("interligne", `${parseFloat(pasAvant).toFixed(1)} px → ${parseFloat(pasApres).toFixed(1)} px`);
check(
  facteur > 1.4,
  "l'interligne grossit avec le zoom, au lieu de resserrer les lignes",
  `${facteur.toFixed(2)}×`,
);
check(
  Math.abs(parseFloat(pasApres) - zoome.largeur * (7 / 210)) < 1.5,
  "et reste à 7 mm de la page, quel que soit le zoom",
  `${parseFloat(pasApres).toFixed(1)} px pour ${(zoome.largeur * (7 / 210)).toFixed(1)}`,
);
await page.getByRole("button", { name: /Zoom \d+ %/ }).click();
await page.waitForTimeout(800);

// --- Le fond dans le PDF exporté --------------------------------------------
section("le fond à l'export");
const { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } = await import(
  "../node_modules/pdf-lib/cjs/index.js"
);

/**
 * Nombre de segments tracés dans le flux de contenu d'une page.
 *
 * `Contents` est un **tableau** de flux dès qu'on ajoute du dessin à une page
 * copiée : pdf-lib y ajoute ses opérateurs sans toucher au contenu d'origine.
 * `node.Contents()` résout déjà la référence ; la chercher à la main rendait un
 * objet indéfini.
 */
const segments = (doc, index) => {
  const contenu = doc.getPage(index).node.Contents();
  const morceaux =
    contenu instanceof PDFArray
      ? contenu.asArray().map((r) => doc.context.lookup(r))
      : [contenu];
  let texte = "";
  for (const m of morceaux) {
    if (!(m instanceof PDFRawStream)) continue;
    texte += Buffer.from(decodePDFRawStream(m).decode()).toString("latin1");
  }
  /*
   * Compter les segments ne suffit pas : l'encre en trace aussi, et beaucoup.
   * La première version de cette sonde comptait 81 segments sur une page
   * prétendument nue et concluait que le réglage y était — alors que c'était
   * une annotation tombée au mauvais endroit.
   *
   * Le réglage se reconnaît à sa **couleur** : un gris que rien d'autre
   * n'emploie, posé en couleur de trait (`RG`) pour les lignes et en couleur de
   * remplissage (`rg`) pour les points.
   */
  const gris = /0\.84 0\.84 0\.86 (RG|rg)/g;
  return {
    repere: (texte.match(gris) ?? []).length,
    lignes: (texte.match(/\bl\s/g) ?? []).length,
  };
};

await page.waitForTimeout(1200);
const reponse = await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=flat`);
check(reponse.status() === 200, "l'export répond", `HTTP ${reponse.status()}`);
const octets = Buffer.from(await reponse.body());
writeFileSync("shots/export-fond-lignes.pdf", octets);
const doc = await PDFDocument.load(octets);
check(doc.getPageCount() === 3, "le PDF exporté a les trois pages", String(doc.getPageCount()));

const ajoutee = segments(doc, 1);
dire("page ajoutée", `${ajoutee.repere} traits de réglage`);
/*
 * C'est ici que le défaut se voyait : l'écran dessinait ses lignes en CSS et
 * l'export les ignorait. Une page à lignes sortait blanche du PDF, et ce qui
 * était écrit entre les lignes se retrouvait suspendu dans le vide.
 */
check(
  ajoutee.repere > 15,
  "et la page ajoutée porte bien son réglage",
  `${ajoutee.repere} traits de réglage — une page blanche n'en a aucun`,
);
// Les pages du document, elles, n'en portent pas : leur image est leur fond.
check(
  segments(doc, 0).repere === 0 && segments(doc, 2).repere === 0,
  "et le réglage ne déborde pas sur les pages du document",
  `${segments(doc, 0).repere} et ${segments(doc, 2).repere}`,
);

// Puis en uni : le même export ne doit plus rien tracer.
await allerPage(1);
await page.getByRole("button", { name: "Uni", exact: true }).click();
await page.waitForTimeout(1400);
const nu = await PDFDocument.load(Buffer.from(await (await page.request.get(`${BASE}/api/notes/${noteId}/pdf?mode=flat`)).body()));
const sansFond = segments(nu, 1);
dire("page uni", `${sansFond.repere} traits de réglage`);
check(
  sansFond.repere === 0,
  "une page uni n'emporte aucun réglage sur le papier",
  `${sansFond.repere} contre ${ajoutee.repere}`,
);

// --- Retirer la page ---------------------------------------------------------
section("retirer la page ajoutée");
await allerPage(1);
const retirer = page.getByRole("button", { name: "Supprimer cette page ajoutée" });
check(await retirer.isVisible(), "on peut retirer une page qu'on a ajoutée");
await retirer.click();
await page.waitForTimeout(1600);
const fini = await etatPages();
dire("pages", fini.bandes.length);
dire("taches d'encre", JSON.stringify(fini.taches));
check(fini.bandes.length === 2, "la pile revient à ses deux pages", String(fini.bandes.length));
check(
  fini.taches.length === 2 && fini.taches[0].page === 0 && fini.taches[1].page === 1,
  "et les annotations retrouvent leur page",
  JSON.stringify(fini.taches),
);

// Une page du document, elle, ne se retire pas : le fichier ne la perdrait pas.
await allerPage(0);
check(
  (await page.getByRole("button", { name: "Supprimer cette page ajoutée" }).count()) === 0,
  "une page du document ne se retire pas",
);
check(
  (await page.getByRole("button", { name: "Lignes", exact: true }).count()) === 0,
  "et son fond ne se choisit pas : son image en tient lieu",
);

// --- Persistance -------------------------------------------------------------
section("persistance");
await allerPage(0);
await page.getByRole("button", { name: "Ajouter une page après celle-ci" }).click();
await page.waitForTimeout(900);
await allerPage(1);
await page.getByRole("button", { name: "Carreaux", exact: true }).click();
await page.waitForTimeout(1800);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const relu = await etatPages();
check(relu.bandes.length === 3, "la page ajoutée survit au rechargement", String(relu.bandes.length));
check(
  relu.bandes[1].classe.includes("paper-grid"),
  "avec son fond",
  relu.bandes[1].classe.match(/paper-\w+/)?.[0] ?? "aucun",
);
check(
  relu.taches.length === 2 && relu.taches[0].page === 0 && relu.taches[1].page === 2,
  "et les annotations sont toujours sur leur page",
  JSON.stringify(relu.taches),
);

// --- La palette une fois le groupe « Page » apparu ---------------------------
/*
 * Un état qui n'apparaît que sous condition n'est vu par aucun audit.
 *
 * Le groupe « Page » ne s'affiche que sur une surface qui porte des pages, et
 * l'audit général ne visite que des notes sans document : deux commandes de
 * plus dans une barre déjà dense, sur un écran de téléphone, sans que rien ne
 * le mesure. On le mesure ici.
 */
section("la palette sur téléphone");
const tel = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
});
await tel.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const petit = await tel.newPage();
await petit.goto(page.url(), { waitUntil: "networkidle" });
await petit.waitForSelector('[data-testid="drawing-canvas"]');
await petit.waitForTimeout(2500);

const barre = petit.getByRole("toolbar", { name: "Outils d'écriture" });
check(await barre.isVisible(), "la palette est là");
check(
  (await petit.getByRole("button", { name: "Ajouter une page après celle-ci" }).count()) === 1,
  "le groupe « Page » y trouve sa place",
);

const debordement = await petit.evaluate(() => {
  const el = document.querySelector('[role="toolbar"]');
  return { scroll: el.scrollWidth, visible: el.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
});
check(
  debordement.scroll <= debordement.visible + 1,
  "sans déborder de sa propre largeur",
  `${debordement.scroll} px pour ${debordement.visible}`,
);
check(debordement.page <= 0, "ni faire déborder la page", `${debordement.page} px`);

// Cible tactile : la règle de Material, celle que l'audit applique partout.
const trop = await petit.evaluate(() => {
  const petits = [];
  for (const b of document.querySelectorAll('[role="toolbar"] button')) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.width < 44 || r.height < 44) {
      petits.push(`${b.getAttribute("aria-label") ?? b.textContent?.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return petits;
});
check(trop.length === 0, "et chaque commande reste attrapable au doigt", trop.join(", "));

await barre.screenshot({ path: "shots/palette-pages-telephone.png" });
await tel.close();

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
