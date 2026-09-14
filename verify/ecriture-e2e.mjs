/*
 * Fluidité et netteté de l'écriture manuscrite.
 *
 * Les quatre défauts constatés à l'usage se ressemblaient — « ça accroche »,
 * « c'est pixelisé », « ça s'effface » — mais aucun ne se voyait dans le code,
 * qui se lisait très bien. Ils se mesurent, en revanche, et c'est ce que fait
 * ce script :
 *
 * 1. **La netteté au zoom.** Un canevas agrandi en CSS multiplie des pixels
 *    déjà tracés. La mesure est directe : le rapport entre la résolution du
 *    canevas et sa taille affichée doit rester égal à la densité de l'écran, à
 *    n'importe quel niveau de zoom. Agrandir par transformation le divise par
 *    le facteur de zoom — c'est exactement ce qu'on voyait.
 * 2. **Le coût de l'écriture.** Il ne doit pas dépendre de ce qu'il y a déjà
 *    sur la page. Un redessin complet par point tracé le rendait proportionnel
 *    au nombre de traits : la première phrase glissait, la trentième traînait.
 *    On compte donc les remplissages et le temps passé dans les gestionnaires,
 *    sur une page vide puis sur une page dense.
 * 3. **La sélection de texte.** iPadOS met la page en surbrillance sur un
 *    appui maintenu. Une feuille ne se sélectionne pas.
 * 4. **L'encre pendant le défilement.** Elle doit glisser avec le papier, sans
 *    être redessinée : faire défiler ne doit produire aucun remplissage.
 *
 * Les mesures passent par un espion posé sur `CanvasRenderingContext2D` : rien
 * n'est ajouté à l'application pour se laisser observer.
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
const ctx = await browser.newContext({
  viewport: { width: 1194, height: 900 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);

/*
 * L'espion.
 *
 * `fill` est l'opération qui coûte : c'est elle qui pose un trait. En les
 * comptant, on mesure le travail réellement demandé au navigateur, sans avoir
 * à croire ce que le code prétend faire.
 */
await ctx.addInitScript(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const fill = proto.fill;
  const clear = proto.clearRect;
  window.__ink = { fill: 0, clear: 0 };
  proto.fill = function (...args) {
    window.__ink.fill++;
    return fill.apply(this, args);
  };
  proto.clearRect = function (...args) {
    window.__ink.clear++;
    return clear.apply(this, args);
  };
  window.__inkReset = () => {
    window.__ink.fill = 0;
    window.__ink.clear = 0;
  };
});

const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 180));
  ko++;
});

/** Trace un trait au stylet, une poignée de points par image, comme une main. */
const tracer = (points, parImage = 3) =>
  page.evaluate(
    async ({ points, parImage }) => {
      const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
      const el = tous[tous.length - 1];
      const r = el.getBoundingClientRect();
      const fire = (type, x, y, p, buttons) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen",
            isPrimary: true, pressure: p, buttons,
            clientX: r.left + r.width * x, clientY: r.top + r.width * y,
          }),
        );
      const image = () => new Promise((res) => requestAnimationFrame(res));

      let passe = 0;
      const debut = performance.now();
      /*
       * La pression est donnée par point, et elle **varie**.
       *
       * Un stylet qui rendrait toujours la même valeur n'existe pas, et la
       * bibliothèque de tracé en tire une conséquence : sans variation, elle
       * considère qu'il n'y a pas de pression mesurée et la remplace par une
       * pression déduite de la vitesse. Un essai à pression constante ne
       * mesurerait donc pas ce que fait un vrai stylet.
       */
      fire("pointerdown", points[0][0], points[0][1], points[0][2] ?? 0.8, 1);
      for (let i = 1; i < points.length; i++) {
        const t0 = performance.now();
        fire("pointermove", points[i][0], points[i][1], points[i][2] ?? 0.8, 1);
        passe += performance.now() - t0;
        if (i % parImage === 0) await image();
      }
      fire("pointerup", points.at(-1)[0], points.at(-1)[1], 0, 0);
      await image();
      return { passe, total: performance.now() - debut, points: points.length };
    },
    { points, parImage },
  );

/** Une ligne ondulée bien échantillonnée, comme une phrase écrite. */
const phrase = (y, n = 60, x0 = 0.08, x1 = 0.9) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [x0 + (x1 - x0) * t, y + Math.sin(t * 14) * 0.012, pression(i)];
  });

/**
 * Pression d'un stylet réel : une consigne lente, et le bruit du capteur.
 *
 * Le bruit est volontaire : c'est lui qui fait grésiller un trait mal rendu, et
 * une mesure qui l'écarterait ne verrait pas le défaut qu'elle cherche.
 */
const pression = (i) => Number((0.62 + Math.sin(i / 9) * 0.1 + Math.sin(i * 2.3) * 0.03).toFixed(3));

/** Les tuiles d'encre : des canevas posés dans la page, pas dans la fenêtre. */
const tuiles = () =>
  page.evaluate(() => {
    return [...document.querySelectorAll("[data-ink-tiles] canvas")].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        w: c.width,
        h: c.height,
        css: Math.round(r.width),
        rapport: r.width > 0 ? c.width / r.width : 0,
      };
    });
  });

const compteur = () => page.evaluate(() => ({ ...window.__ink }));
const remettre = () => page.evaluate(() => window.__inkReset());

// --- Préparation --------------------------------------------------------------
section("préparation");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Écriture ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.getByRole("button", { name: "Croquis", exact: true }).last().click();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);

// Un trait **droit**, horizontal : sa forme attendue se calcule à la main, ce
// qui permet de vérifier non pas qu'il y a de l'encre, mais qu'elle a la bonne
// forme.
const DROIT = { y: 0.2, x0: 0.08, x1: 0.9, taille: 2.5 };
/*
 * L'espacement des points est **irrégulier d'un point au suivant**, comme
 * celui d'une vraie main.
 *
 * Avec des points parfaitement répartis — ou même espacés selon une belle
 * sinusoïde — une largeur déduite de la vitesse sort parfaitement constante :
 * le défaut se cache, et la sonde ne le voit qu'à l'épaisseur moyenne, pas au
 * grésillement, c'est-à-dire pas là où l'œil le voit. Il faut le tremblement
 * d'un échantillon à l'autre, qui est ce que produit un vrai stylet.
 *
 * Le tirage est déterministe : un essai qui change de valeurs à chaque
 * exécution rend ses échecs impossibles à comparer.
 */
let graine = 20260914;
const alea = () => {
  graine = (graine * 1103515245 + 12345) % 2147483648;
  return graine / 2147483648;
};
const pas = Array.from({ length: 60 }, () => 0.5 + alea() * 1.8);
const total = pas.reduce((s, v) => s + v, 0);
let avance = 0;
await tracer(
  pas.map((p, i) => {
    const x = DROIT.x0 + ((DROIT.x1 - DROIT.x0) * avance) / total;
    avance += p;
    return [x, DROIT.y, pression(i)];
  }),
);
await page.waitForTimeout(1200);
const label = await page.locator('[data-testid="drawing-canvas"]').last().getAttribute("aria-label");
check(/1 trait/.test(label ?? ""), "un trait est posé", String(label));

/**
 * L'encre posée sur les tuiles : son étendue, sa surface, et son **profil
 * d'épaisseur** colonne par colonne.
 *
 * C'est le profil qui dit si un trait est agréable. Une largeur qui varie de
 * quelques pour cent le long du trait, c'est une plume ; une largeur qui saute
 * d'un quart d'un point au suivant, c'est du grésillement — et c'est ce qu'on
 * obtient quand la largeur suit la vitesse de la main au lieu de la pression.
 */
const forme = (bande = null) =>
  page.evaluate((bande) => {
    let n = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let largeurRendu = 0;
    const colonnes = new Map();

    for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
      const ctx = c.getContext("2d");
      if (!ctx || c.width === 0) continue;
      largeurRendu = Math.max(largeurRendu, c.width);
      const haut = Number(c.dataset.inkTile.split(":")[1]) * c.height;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let py = 0; py < c.height; py++) {
        const yTuile = haut + py;
        // Une bande permet de ne mesurer qu'un trait quand la page en porte
        // plusieurs : sans elle, deux traits superposés en colonne comptent
        // pour un seul, deux fois plus épais.
        if (bande && (yTuile < bande.min || yTuile > bande.max)) continue;
        for (let px = 0; px < c.width; px++) {
          const a = data[(py * c.width + px) * 4 + 3];
          if (a <= 8) continue;
          n++;
          const y = yTuile;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          // L'épaisseur d'une colonne est pondérée par l'opacité : le bord d'un
          // trait est lissé, et le compter en tout ou rien ajouterait au profil
          // un bruit d'un pixel qui n'est pas celui qu'on cherche.
          colonnes.set(px, (colonnes.get(px) ?? 0) + a / 255);
        }
      }
    }

    // Les colonnes du cœur du trait : les extrémités s'effilent par
    // construction, les compter ferait passer une plume pour un grésillement.
    const cles = [...colonnes.keys()].sort((a, b) => a - b);
    const coeur = cles.slice(Math.round(cles.length * 0.15), Math.round(cles.length * 0.85));
    const profil = coeur.map((k) => colonnes.get(k));
    const moyenne = profil.reduce((s, v) => s + v, 0) / (profil.length || 1);
    const ecart = Math.sqrt(
      profil.reduce((s, v) => s + (v - moyenne) ** 2, 0) / (profil.length || 1),
    );

    return {
      n,
      hauteur: maxY - minY + 1,
      largeur: maxX - minX + 1,
      largeurRendu,
      epaisseur: moyenne,
      bruit: moyenne ? (ecart / moyenne) * 100 : 0,
    };
  }, bande);

/*
 * La forme du trait, et non sa seule présence.
 *
 * C'est la mesure qui manquait : en calculant les contours sur des coordonnées
 * comprises entre 0 et 1, les seuils internes de `perfect-freehand` écartaient
 * presque tous les points et le trait devenait une tache large de la moitié de
 * la page. Toutes les autres vérifications passaient — elles comptaient des
 * traits, pas des pixels.
 */
const f = await forme();
const epaisseurVoulue = (2.5 / 1000) * f.largeurRendu;
const longueurVoulue = (DROIT.x1 - DROIT.x0) * f.largeurRendu;
dire(
  "trait mesuré",
  `${f.largeur} × ${f.hauteur} px pour ${Math.round(longueurVoulue)} × ${epaisseurVoulue.toFixed(1)} attendus`,
);
check(
  f.hauteur <= epaisseurVoulue * 3 + 4,
  "un trait droit reste un trait, pas une tache",
  `${f.hauteur} px d'épaisseur pour ${epaisseurVoulue.toFixed(1)} attendus`,
);
check(
  Math.abs(f.largeur - longueurVoulue) / longueurVoulue < 0.1,
  "et il fait la longueur qu'on a tracée",
  `${f.largeur} px pour ${Math.round(longueurVoulue)}`,
);
check(
  f.n > longueurVoulue * epaisseurVoulue * 0.5 && f.n < longueurVoulue * epaisseurVoulue * 2,
  "la surface d'encre est celle d'un trait de cette épaisseur",
  `${f.n} pixels pour ${Math.round(longueurVoulue * epaisseurVoulue)} attendus`,
);

/*
 * L'épaisseur, et sa régularité.
 *
 * `perfect-freehand` **simule** la pression par défaut, à partir de la vitesse
 * du geste, et cette simulation remplace celle que le stylet a mesurée. Deux
 * conséquences, mesurées ici parce qu'elles ne se voient pas dans le code :
 *
 * - le trait sortait **trois fois trop fin** — 0,96 pour 2,80 demandés ;
 * - et sa largeur **grésillait** en suivant la main, à 23 % de variation le
 *   long d'un trait droit contre 8 % avec la vraie pression.
 */
dire(
  "épaisseur mesurée",
  `${f.epaisseur.toFixed(2)} px pour ${epaisseurVoulue.toFixed(2)} demandés, ${f.bruit.toFixed(1)} % de variation`,
);
check(
  f.epaisseur > epaisseurVoulue * 0.7 && f.epaisseur < epaisseurVoulue * 1.5,
  "le trait a l'épaisseur qu'on lui a demandée",
  `${f.epaisseur.toFixed(2)} px pour ${epaisseurVoulue.toFixed(2)} — une pression devinée le divise par trois`,
);
check(
  f.bruit < 14,
  "et sa largeur ne grésille pas le long du trait",
  `${f.bruit.toFixed(1)} % de variation — la pression déduite de la vitesse en donne le double`,
);

/*
 * Ce qu'on voit en écrivant est-il ce qui reste ?
 *
 * Le trait en cours vit sur sa propre couche, et n'y redessine que sa queue —
 * c'est ce qui rend le coût par image indépendant de la longueur du trait. Mais
 * une queue est un **morceau** de trait : si l'épaisseur se déduit d'autre
 * chose que de la pression de chaque point, chaque morceau la recalcule pour
 * son compte. Deux conséquences, et ce sont exactement celles qu'on ressent
 * sous la main :
 *
 *  - l'épaisseur saute d'une queue à l'autre, soixante fois par seconde —
 *    le trait « grésille » pendant qu'on écrit ;
 *  - et elle change encore au moment où l'on lève la pointe, quand le trait
 *    passe sur la couche fixe. Mesuré, avec le défaut : 5,19 px en écrivant,
 *    2,00 px une fois posé.
 */
section("écrire et poser donnent le même trait");

/*
 * La hauteur du trait d'essai, dans la page.
 *
 * Elle doit tomber **dans la fenêtre visible** : la couche vive ne couvre que
 * ce qui est à l'écran, et un trait tracé plus bas n'y laisserait rien à
 * mesurer — la sonde accuserait alors l'application d'un trait invisible.
 */
const VIF_Y = 0.4;

/** Trace sans lever la pointe, et rend le profil de la couche vive. */
const traitEnCours = () =>
  page.evaluate(async (VIF_Y) => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    const fire = (t, x, y, p, bt) =>
      el.dispatchEvent(
        new PointerEvent(t, {
          bubbles: true, cancelable: true, pointerId: 3, pointerType: "pen",
          isPrimary: true, pressure: p, buttons: bt,
          clientX: r.left + r.width * x, clientY: r.top + r.width * y,
        }),
      );
    let g = 987654321;
    const tirage = () => {
      g = (g * 1103515245 + 12345) % 2147483648;
      return g / 2147483648;
    };
    let x = 0.08;
    fire("pointerdown", x, VIF_Y, 0.62, 1);
    for (let i = 1; i < 90; i++) {
      x += 0.0005 + tirage() * 0.002;
      fire("pointermove", x, VIF_Y, 0.62 + Math.sin(i / 9) * 0.1, 1);
      if (i % 3 === 0) await new Promise((res) => requestAnimationFrame(res));
    }
    await new Promise((res) => requestAnimationFrame(res));

    // La couche vive : le canevas collant qui ne reçoit pas les pointeurs.
    const vive = [...document.querySelectorAll("[data-ink-scroll] canvas")].filter(
      (cv) => getComputedStyle(cv).position === "sticky",
    )[0];
    const ctx = vive.getContext("2d");
    const d = ctx.getImageData(0, 0, vive.width, vive.height).data;
    const cols = new Map();
    for (let py = 0; py < vive.height; py++) {
      for (let px = 0; px < vive.width; px++) {
        const a = d[(py * vive.width + px) * 4 + 3];
        if (a > 8) cols.set(px, (cols.get(px) ?? 0) + a / 255);
      }
    }
    const cles = [...cols.keys()].sort((a, b) => a - b);
    const coeur = cles
      .slice(Math.round(cles.length * 0.15), Math.round(cles.length * 0.85))
      .map((k) => cols.get(k));
    const m = coeur.reduce((s, v) => s + v, 0) / (coeur.length || 1);
    const sd = Math.sqrt(coeur.reduce((s, v) => s + (v - m) ** 2, 0) / (coeur.length || 1));

    // On lève la pointe : le trait passe sur la couche fixe.
    fire("pointerup", x, VIF_Y, 0, 0);
    return { epaisseur: m, bruit: m ? (sd / m) * 100 : 0, fin: x };
  }, VIF_Y);

const vif = await traitEnCours();
await page.waitForTimeout(1400);
// La même bande que le trait qu'on vient de tracer : la page en porte un autre.
const densiteRendu = (await forme()).largeurRendu;
const pose = await forme({
  min: VIF_Y * densiteRendu - 40,
  max: VIF_Y * densiteRendu + 40,
});
dire(
  "en écrivant / une fois posé",
  `${vif.epaisseur.toFixed(2)} px / ${pose.epaisseur.toFixed(2)} px`,
);
check(
  vif.epaisseur > 0,
  "la couche vive porte bien le trait en cours",
  `${vif.epaisseur.toFixed(2)} px`,
);
check(
  Math.abs(vif.epaisseur - pose.epaisseur) / pose.epaisseur < 0.15,
  "le trait ne change pas d'épaisseur quand on lève la pointe",
  `${vif.epaisseur.toFixed(2)} px en écrivant, ${pose.epaisseur.toFixed(2)} px une fois posé`,
);
check(
  vif.bruit < 14,
  "et il ne grésille pas d'une image à l'autre pendant qu'on écrit",
  `${vif.bruit.toFixed(1)} % de variation`,
);

// --- 1. Netteté au zoom -------------------------------------------------------
section("netteté au zoom");

const densite = await page.evaluate(() => Math.min(window.devicePixelRatio || 1, 2));
dire("densité d'écran", densite);

const avant = await tuiles();
check(avant.length > 0, "l'encre vit sur des tuiles posées dans la page", JSON.stringify(avant));
const netAvant = Math.min(...avant.map((t) => t.rapport));
check(
  netAvant >= densite - 0.02,
  "à taille normale, un pixel d'écran vaut un pixel de canevas",
  `rapport ${netAvant.toFixed(2)} pour une densité de ${densite}`,
);

/** Pince à deux doigts pour zoomer. */
const pincer = (ecart) =>
  page.evaluate(async (ecart) => {
    const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
    const el = tous[tous.length - 1];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type, id, x, y, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
          isPrimary: id === 1, pressure: 0.5, buttons, clientX: x, clientY: y,
        }),
      );
    fire("pointerdown", 1, cx - 40, cy, 1);
    fire("pointerdown", 2, cx + 40, cy, 1);
    for (let i = 1; i <= 12; i++) {
      const d = 40 + (ecart / 2 - 40) * (i / 12);
      fire("pointermove", 1, cx - d, cy, 1);
      fire("pointermove", 2, cx + d, cy, 1);
      await new Promise((res) => requestAnimationFrame(res));
    }
    fire("pointerup", 1, cx - ecart / 2, cy, 0);
    fire("pointerup", 2, cx + ecart / 2, cy, 0);
  }, ecart);

const largeurPage = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="drawing-canvas"]');
    return el ? Math.round(el.parentElement.getBoundingClientRect().width) : 0;
  });

const pageAvant = await largeurPage();
await pincer(520);
await page.waitForTimeout(700);
const pageApres = await largeurPage();
const zoom = pageApres / pageAvant;
dire("zoom obtenu", `${zoom.toFixed(2)}× (${pageAvant} → ${pageApres} px)`);
check(zoom > 1.5, "la page s'agrandit vraiment", `${zoom.toFixed(2)}×`);

const apresZoom = await tuiles();
const netApres = Math.min(...apresZoom.map((t) => t.rapport));
check(
  netApres >= densite - 0.02,
  "et l'encre est **rasterisée à la taille affichée**, pas étirée",
  `rapport ${netApres.toFixed(2)} au zoom ${zoom.toFixed(2)}× — étirer en CSS le ferait tomber vers ${(densite / zoom).toFixed(2)}`,
);
check(
  await page.evaluate(() =>
    [...document.querySelectorAll("[data-ink-scroll] canvas, [data-ink-scroll] > div")].every(
      (el) => !/scale/.test(el.style.transform || ""),
    ),
  ),
  "aucune couche n'est agrandie par transformation CSS",
);

// Aucune tuile ne doit dépasser la limite de Safari, sous peine de page blanche.
const tropGrande = apresZoom.find((t) => t.w > 4096 || t.h > 4096);
check(!tropGrande, "aucune tuile ne dépasse 4096 px de côté", JSON.stringify(tropGrande ?? {}));

await page.getByRole("button", { name: /Zoom \d+ %/ }).click();
await page.waitForTimeout(600);

// --- 2. Le coût de l'écriture ne dépend pas de la densité de la page ----------
section("coût de l'écriture");

await remettre();
const mesureVide = await tracer(phrase(0.32));
const compteVide = await compteur();
await page.waitForTimeout(900);
dire(
  "page presque vide",
  `${compteVide.fill} remplissages, ${(mesureVide.passe / mesureVide.points).toFixed(2)} ms par point`,
);

// On charge la page : deux cents traits courts, comme une page de cours.
process.stdout.write("   remplissage de la page…");
for (let i = 0; i < 200; i++) {
  const y = 0.42 + (i % 40) * 0.012;
  const x = 0.08 + Math.floor(i / 40) * 0.17;
  await tracer(
    Array.from({ length: 6 }, (_, k) => [x + k * 0.018, y + Math.sin(k) * 0.004]),
    6,
  );
}
process.stdout.write(" fait.\n");
await page.waitForTimeout(1500);
const densiteLabel = await page.locator('[data-testid="drawing-canvas"]').last().getAttribute("aria-label");
dire("page chargée", String(densiteLabel));

await remettre();
const mesureDense = await tracer(phrase(0.95));
const compteDense = await compteur();
dire(
  "page dense",
  `${compteDense.fill} remplissages, ${(mesureDense.passe / mesureDense.points).toFixed(2)} ms par point`,
);

/*
 * Le nombre de remplissages pendant un trait doit rester du même ordre que le
 * nombre d'images, **pas** du nombre de traits déjà sur la page. Un redessin
 * complet par point donnerait ici plusieurs milliers de remplissages.
 */
check(
  compteDense.fill < 600,
  "écrire sur une page dense ne redessine pas la page",
  `${compteDense.fill} remplissages pour un seul trait`,
);
const facteur = compteDense.fill / Math.max(1, compteVide.fill);
check(
  facteur < 6,
  "et le coût ne se met pas à suivre le nombre de traits",
  `${facteur.toFixed(1)}× entre page vide et page dense`,
);

/*
 * Le temps, lui, ne prouve rien à lui seul : sur cette machine, un navigateur
 * sans fenêtre encaisse un redessin complet en un sixième de milliseconde.
 * Réintroduire le défaut a bien fait bondir les remplissages de 80 à 9 007,
 * mais le chronomètre est resté sous le seuil. On le garde comme témoin d'un
 * dérapage grossier, pas comme garde-fou : c'est le compte des remplissages qui
 * tient ce rôle.
 */
const parPoint = mesureDense.passe / mesureDense.points;
check(
  parPoint < 4,
  "le temps passé dans le gestionnaire reste sous 4 ms par point (témoin)",
  `${parPoint.toFixed(2)} ms`,
);

// --- 3. Un appui maintenu ne sélectionne rien --------------------------------
section("appui maintenu");

const appui = await page.evaluate(async () => {
  const tous = document.querySelectorAll('[data-testid="drawing-canvas"]');
  const el = tous[tous.length - 1];
  const r = el.getBoundingClientRect();
  const ev = new PointerEvent("pointerdown", {
    bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch",
    isPrimary: true, pressure: 0.5, buttons: 1,
    clientX: r.left + r.width / 2, clientY: r.top + 60,
  });
  // `dispatchEvent` rend faux dès que quelqu'un a appelé preventDefault : c'est
  // la seule façon de vérifier que le geste natif est bien coupé.
  const passe = el.dispatchEvent(ev);
  await new Promise((res) => setTimeout(res, 900));
  el.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch",
      buttons: 0, clientX: r.left + r.width / 2, clientY: r.top + 60,
    }),
  );
  const surface = document.querySelector("[data-ink-scroll]");
  const style = getComputedStyle(surface);
  /*
   * `-webkit-touch-callout` n'est pas exposé par le style calculé de Chromium :
   * c'est une propriété de Safari, et c'est justement Safari qui ouvre le menu
   * système sur un appui prolongé. On vérifie donc que la **déclaration** est
   * bien livrée dans la feuille de style, ce dont Safari a besoin — et non ce
   * que le navigateur de mesure veut bien en dire.
   */
  return {
    coupe: !passe,
    userSelect: style.webkitUserSelect || style.userSelect,
    feuilles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
    porte: surface.className.includes("ink-surface"),
    selection: String(window.getSelection() ?? ""),
  };
});

/*
 * `-webkit-touch-callout` est une propriété de Safari, et c'est Safari qui
 * ouvre le menu système sur un appui prolongé. Chromium ne la connaît pas : il
 * la jette à l'analyse, elle est donc absente de son style calculé comme de
 * `cssText`. On relit la feuille **telle qu'elle est livrée**, seule chose dont
 * dépend le comportement sur l'iPad.
 */
let callout = false;
for (const url of appui.feuilles) {
  const css = await fetch(url, { headers: { Cookie: `fiches_session=${token}` } }).then((r) => r.text());
  const regle = /\.ink-surface\s*\{([^}]*)\}/.exec(css);
  if (regle && /-webkit-touch-callout:\s*none/.test(regle[1])) callout = true;
}
check(appui.coupe, "le geste par défaut du navigateur est coupé dès l'appui");
check(appui.userSelect === "none", "la surface n'est pas sélectionnable", appui.userSelect);
check(appui.porte, "la surface porte la classe qui coupe les gestes de texte");
check(callout, "et la feuille livrée interdit le menu système de l'appui prolongé");
check(appui.selection === "", "rien n'est passé en surbrillance", `« ${appui.selection} »`);

// --- 3 bis. La main posée sur les commandes ----------------------------------
/*
 * La barre d'outils et le repère de page flottent en bas de l'écran — là où la
 * main se pose pour écrire. La paume y déclenchait ce qu'un doigt y
 * déclencherait : la sélection d'iPadOS, et parfois un bouton.
 *
 * Trois cas, et ils doivent se distinguer :
 *  - la main posée pendant qu'on écrit → ignorée ;
 *  - un contact large, même stylet levé → ignoré, car la main se pose souvent
 *    **avant** que la pointe ne touche ;
 *  - un doigt ordinaire, aucun stylet en jeu → la barre répond normalement.
 */
section("la main posée sur les commandes");

/** Touche la barre d'outils, avec le rayon de contact voulu. */
const toucherBarre = (rayon) =>
  page.evaluate(({ rayon }) => {
    const barre = document.querySelector('[role="toolbar"]');
    const bouton = barre.querySelector('button[aria-label="Surligneur"]');
    const r = bouton.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    let active = false;
    const voir = () => {
      active = true;
    };
    bouton.addEventListener("click", voir, true);

    const touche = new Touch({
      identifier: 77,
      target: bouton,
      clientX: x,
      clientY: y,
      radiusX: rayon,
      radiusY: rayon,
      force: 1,
    });
    const debut = new TouchEvent("touchstart", {
      bubbles: true, cancelable: true, touches: [touche], targetTouches: [touche], changedTouches: [touche],
    });
    const passe = bouton.dispatchEvent(debut);
    bouton.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerId: 77, pointerType: "touch",
        isPrimary: true, buttons: 1, clientX: x, clientY: y, width: rayon * 2, height: rayon * 2,
      }),
    );
    bouton.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true, cancelable: true, pointerId: 77, pointerType: "touch", buttons: 0, clientX: x, clientY: y,
      }),
    );
    // Le clic de compatibilité, celui qui presse réellement le bouton.
    bouton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    bouton.removeEventListener("click", voir, true);

    return { coupe: !passe, active, selection: String(window.getSelection() ?? "") };
  }, { rayon });

/** Pose la pointe sur la feuille, sans la lever. */
const poserStylet = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: "pen",
        isPrimary: true, pressure: 0.6, buttons: 1,
        clientX: r.left + r.width / 2, clientY: r.top + 80,
      }),
    );
  });
const leverStylet = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: "pen",
        buttons: 0, clientX: r.left + r.width / 2, clientY: r.top + 80,
      }),
    );
  });

// 1. Pendant qu'on écrit : la main ne doit rien déclencher.
await poserStylet();
const enEcrivant = await toucherBarre(20);
check(enEcrivant.coupe, "le geste est coupé dès le contact, pendant qu'on écrit");
check(!enEcrivant.active, "la main posée n'appuie aucun bouton");
check(enEcrivant.selection === "", "et ne sélectionne rien", `« ${enEcrivant.selection} »`);
await leverStylet();

// 2. Un contact large, stylet levé : c'est le tranchant de la main, qui se
//    pose presque toujours avant que la pointe ne touche.
await page.waitForTimeout(1100);
const large = await toucherBarre(60);
check(large.coupe, "un contact large est refusé, même la pointe levée");
check(!large.active, "et n'appuie aucun bouton", String(large.active));

// 3. Un doigt ordinaire doit continuer de fonctionner : la barre ne devient pas
//    inerte sous prétexte qu'un stylet a servi. Le délai est celui d'un geste
//    humain — on ne tapote pas un bouton un dixième de seconde après y avoir
//    posé la main.
await page.waitForTimeout(700);
const doigt = await toucherBarre(18);
check(!doigt.coupe, "un doigt ordinaire n'est pas refusé");
check(doigt.active, "et la commande répond normalement");

// --- 4. L'encre pendant le défilement ----------------------------------------
section("défilement d'un document annoté");

await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Défilement ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();

const tImport = Date.now();
await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles("doc-test.pdf");
await page.waitForSelector('[data-testid="drawing-canvas"]', { timeout: 60000 });
await page.getByRole("button", { name: "Document" }).waitFor({ timeout: 60000 });
dire("import du document", `${((Date.now() - tImport) / 1000).toFixed(1)} s`);
check(true, "l'import se termine et le bouton revient à son état de repos");
await page.waitForTimeout(1500);

await tracer(phrase(0.25, 50));
await page.waitForTimeout(1400);

/** Pixels d'encre effectivement posés sur les tuiles. */
const encre = () =>
  page.evaluate(() => {
    let n = 0;
    // Les tuiles d'encre seulement : les pages du document sont opaques, et les
    // compter revenait à compter tous les pixels de l'écran.
    for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
      const ctx = c.getContext("2d");
      if (!ctx || c.width === 0) continue;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
    }
    return n;
  });

const encreAvant = await encre();
check(encreAvant > 500, "l'encre est bien posée sur les tuiles", `${encreAvant} pixels`);

// Petit défilement, dans la marge déjà peinte : rien ne doit être redessiné.
await remettre();
await page.evaluate(() => {
  document.querySelector("[data-ink-scroll]").scrollTop += 180;
});
await page.waitForTimeout(500);
const pendant = await compteur();
dire("défilement de 180 px", `${pendant.fill} remplissages`);
check(
  pendant.fill === 0,
  "faire défiler ne redessine pas l'encre : les tuiles glissent avec le papier",
  `${pendant.fill} remplissages — c'est ce redessin qui faisait disparaître l'écriture`,
);

// Puis on s'en va loin, et on revient : l'encre doit être là, et à sa place.
await page.evaluate(() => {
  const s = document.querySelector("[data-ink-scroll]");
  s.scrollTop = s.scrollHeight;
});
await page.waitForTimeout(900);
await page.evaluate(() => {
  document.querySelector("[data-ink-scroll]").scrollTop = 0;
});
await page.waitForTimeout(1200);
const encreApres = await encre();
const ecart = Math.abs(encreApres - encreAvant) / Math.max(1, encreAvant);
dire("encre au retour", `${encreApres} pixels (${(ecart * 100).toFixed(1)} % d'écart)`);
check(
  ecart < 0.08,
  "et revenir la retrouve entière, ni rognée ni effacée",
  `${encreAvant} → ${encreApres} pixels`,
);

// Le fond du document suit le zoom, lui aussi : un fond rasterisé une fois pour
// toutes serait aussi flou que l'encre l'était.
const fond = await page.evaluate(() => {
  const c = [...document.querySelectorAll('[aria-label^="Page 1 du document"]')][0];
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { rapport: r.width > 0 ? c.width / r.width : 0, css: Math.round(r.width) };
});
if (fond) {
  dire("fond de document", `${fond.rapport.toFixed(2)} pixel de rendu par pixel affiché`);
  check(fond.rapport >= 1.4, "le fond du document est rendu au-dessus de la densité d'écran", JSON.stringify(fond));
}

console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
