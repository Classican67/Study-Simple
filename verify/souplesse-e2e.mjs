/*
 * Souplesse du tracé : le trait est-il celui de la main, ou celui du capteur ?
 *
 * `ecriture-e2e.mjs` mesure la **netteté** et le **coût** : le trait a la bonne
 * épaisseur, il ne grésille pas, il ne coûte pas plus cher sur une page dense.
 * Rien là-dedans ne dit s'il est agréable à tracer — un trait parfaitement net
 * peut onduler, arrondir les angles, finir avant la main et sortir en ligne
 * brisée. Ce sont quatre choses différentes, et elles se mesurent :
 *
 * 1. **Le tremblement.** Écrit lentement, un trait droit ondule : c'est le
 *    bruit du capteur, amplifié par le fait qu'on le voit à l'arrêt. La sonde
 *    trace deux fois la même droite, une propre et une secouée d'un
 *    tremblement connu, et compare la **hauteur d'encre** des deux. Le filtre
 *    doit rendre la seconde presque aussi fine que la première.
 * 2. **Les angles.** Tout lissage arrondit, et un lissage à coefficient fixe
 *    arrondit d'autant plus qu'on va vite. Un « v » tracé d'un geste vif y
 *    perd son sommet — ce qui, sur une page d'écriture, se lit comme une
 *    bouillie. La sonde mesure la profondeur réellement atteinte.
 * 3. **Le retard.** Un filtre traîne, par construction. Au lever de la pointe,
 *    le trait doit avoir **rattrapé** la main : sinon chaque lettre finit un
 *    peu avant sa fin.
 * 4. **Les trous.** Une souris n'échantillonne qu'à soixante hertz : un arc
 *    tracé d'un geste rapide n'y laisse que quelques points, et sort en
 *    polygone. La sonde mesure l'écart au cercle.
 *
 * Tout se mesure en lisant **les pixels des tuiles**, comme le reste : rien
 * n'est ajouté à l'application pour se laisser observer.
 *
 * Une précision sur le temps. Un filtre en temps réel n'a de sens qu'avec de
 * vrais horodatages, et un script qui expédie ses événements dans une boucle
 * serrée les date tous à la même milliseconde — le filtre y verrait une main
 * lancée à des vitesses folles et ne lisserait rien. Les points sont donc
 * espacés d'une **vraie** attente, et la vitesse obtenue est affichée : c'est
 * elle qui donne son sens aux chiffres qui suivent.
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
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  console.log("   erreur page :", String(e).slice(0, 180));
  ko++;
});

/**
 * Trace un geste, à une **cadence maîtrisée**.
 *
 * Deux raisons de ne pas s'en remettre à `setTimeout`. D'abord un filtre en
 * temps réel n'a de sens qu'avec de vrais horodatages, et une boucle serrée
 * date tous ses points à la même milliseconde : le filtre y verrait une main
 * lancée à des vitesses folles, et ne lisserait rien. Ensuite `setTimeout` ne
 * descend pas sous quelques millisecondes et rend ce qu'il veut, alors qu'un
 * stylet échantillonne à deux cents hertz, régulièrement — or c'est la cadence
 * qui décide de la force du lissage, et une sonde qui la laisse flotter mesure
 * autre chose à chaque exécution.
 *
 * On attend donc **activement**. Le rendu n'a pas lieu pendant ce temps, ce qui
 * est sans effet sur ce qu'on mesure : l'encre est lue sur les tuiles, une fois
 * la pointe levée.
 */
const tracer = (points, periode = 5, type = "pen") =>
  page.evaluate(
    async ({ points, periode, type }) => {
      const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
      const r = el.getBoundingClientRect();
      const fire = (t, p, pression, boutons) =>
        el.dispatchEvent(
          new PointerEvent(t, {
            bubbles: true, cancelable: true, pointerId: 11, pointerType: type,
            isPrimary: true, pressure: pression, buttons: boutons,
            clientX: r.left + r.width * p[0], clientY: r.top + r.width * p[1],
          }),
        );
      const attendre = (jusque) => {
        while (performance.now() < jusque) {
          /* vide : c'est l'attente elle-même */
        }
      };

      const debut = performance.now();
      fire("pointerdown", points[0], points[0][2] ?? 0.65, 1);
      for (let i = 1; i < points.length; i++) {
        attendre(debut + i * periode);
        fire("pointermove", points[i], points[i][2] ?? 0.65, 1);
      }
      fire("pointerup", points.at(-1), 0, 0);
      const duree = (performance.now() - debut) / 1000;

      // La longueur parcourue, en unités de mille : de quoi rendre une vitesse.
      let course = 0;
      for (let i = 1; i < points.length; i++) {
        course += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      }
      await new Promise((res) => requestAnimationFrame(res));
      return { duree, vitesse: (course * 1000) / duree, hz: (points.length - 1) / duree };
    },
    { points, periode, type },
  );

/**
 * L'encre posée sur les tuiles, dans une bande donnée de la page.
 *
 * Rendue en pixels de tuile, et accompagnée de la densité de rendu : c'est
 * elle qui traduit une unité de page en pixels, et sans elle aucun seuil n'a
 * de sens.
 */
const encre = (bande) =>
  page.evaluate((bande) => {
    const pixels = [];
    let largeurRendu = 0;
    for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
      const ctx = c.getContext("2d");
      if (!ctx || c.width === 0) continue;
      largeurRendu = Math.max(largeurRendu, c.width);
      const haut = Number(c.dataset.inkTile.split(":")[1]) * c.height;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let py = 0; py < c.height; py++) {
        const y = haut + py;
        if (y < bande.min || y > bande.max) continue;
        for (let px = 0; px < c.width; px++) {
          if (data[(py * c.width + px) * 4 + 3] > 8) pixels.push([px, y]);
        }
      }
    }
    if (pixels.length === 0) return { n: 0, largeurRendu };
    const xs = pixels.map((p) => p[0]);
    const ys = pixels.map((p) => p[1]);
    return {
      n: pixels.length,
      largeurRendu,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      hauteur: Math.max(...ys) - Math.min(...ys) + 1,
      largeur: Math.max(...xs) - Math.min(...xs) + 1,
    };
  }, bande);

/**
 * L'**ondulation** d'un trait : ce qui reste du tremblement, en pixels.
 *
 * La hauteur de la bande d'encre est une mesure de crête : un seul pixel mal
 * placé la fait bondir, et l'épaisseur du trait s'y ajoute. On mesure plutôt
 * le **milieu** du trait colonne par colonne — pondéré par l'opacité, donc
 * insensible à l'épaisseur — et l'écart quadratique de ce milieu à la droite
 * qui l'approche le mieux. C'est exactement la grandeur qu'on voit onduler.
 */
const ondulation = (bande) =>
  page.evaluate((bande) => {
    const somme = new Map();
    const poids = new Map();
    for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
      const ctx = c.getContext("2d");
      if (!ctx || c.width === 0) continue;
      const haut = Number(c.dataset.inkTile.split(":")[1]) * c.height;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let py = 0; py < c.height; py++) {
        const y = haut + py;
        if (y < bande.min || y > bande.max) continue;
        for (let px = 0; px < c.width; px++) {
          const a = data[(py * c.width + px) * 4 + 3] / 255;
          if (a <= 0.03) continue;
          somme.set(px, (somme.get(px) ?? 0) + a * y);
          poids.set(px, (poids.get(px) ?? 0) + a);
        }
      }
    }
    const xs = [...poids.keys()].sort((a, b) => a - b);
    // Les extrémités s'effilent et tirent le milieu : on garde le cœur.
    const coeur = xs.slice(Math.round(xs.length * 0.08), Math.round(xs.length * 0.92));
    if (coeur.length < 10) return { n: coeur.length, rms: 0 };
    const pts = coeur.map((x) => [x, somme.get(x) / poids.get(x)]);
    // Droite des moindres carrés : on mesure l'écart au trait voulu, pas sa pente.
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    const num = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    const den = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1;
    const pente = num / den;
    const carres = pts.reduce((s, p) => s + (p[1] - (my + pente * (p[0] - mx))) ** 2, 0);
    return { n, rms: Math.sqrt(carres / n) };
  }, bande);

/** Le rayon le plus faible atteint par l'encre autour d'un centre donné. */
const rayons = (bande, cx, cy) =>
  page.evaluate(
    ({ bande, cx, cy }) => {
      let mini = Infinity;
      let maxi = 0;
      for (const c of document.querySelectorAll("[data-ink-tiles] canvas")) {
        const ctx = c.getContext("2d");
        if (!ctx || c.width === 0) continue;
        const haut = Number(c.dataset.inkTile.split(":")[1]) * c.height;
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        for (let py = 0; py < c.height; py++) {
          const y = haut + py;
          if (y < bande.min || y > bande.max) continue;
          for (let px = 0; px < c.width; px++) {
            if (data[(py * c.width + px) * 4 + 3] <= 8) continue;
            const r = Math.hypot(px - cx, y - cy);
            if (r < mini) { mini = r; window.__ou = [px, y]; }
            if (r > maxi) maxi = r;
          }
        }
      }
      return { mini, maxi, ou: window.__ou };
    },
    { bande, cx, cy },
  );

/** Un tirage déterministe : un échec doit se comparer d'une exécution à l'autre. */
let graine = 20260923;
const alea = () => {
  graine = (graine * 1103515245 + 12345) % 2147483648;
  return graine / 2147483648 - 0.5;
};

// --- Préparation --------------------------------------------------------------
section("préparation");
await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nouvelle note" }).click();
await page.waitForURL(/\/notes\/[a-z0-9]+/);
await page.getByLabel("Titre de la note").fill(`Souplesse ${Date.now()}`);
await page.getByLabel("Titre de la note").blur();
await page.waitForSelector('[data-testid="drawing-canvas"]');
await page.waitForTimeout(600);

const zero = await encre({ min: 0, max: 1e9 });
const REND = zero.largeurRendu;
/** Une unité de page (un millième) vaut tant de pixels de tuile. */
const U = REND / 1000;
dire("densité de rendu", `${REND} px pour une page, soit ${U.toFixed(2)} px par unité`);
check(REND > 0, "les tuiles d'encre existent");

/** La bande de la page qui n'appartient qu'à ce trait. */
const bande = (y, demi = 0.06) => ({ min: (y - demi) * REND, max: (y + demi) * REND });

// --- 1. Le tremblement ---------------------------------------------------------
/*
 * Deux fois la même droite : une propre, une secouée.
 *
 * Le tremblement injecté vaut trois unités de page de part et d'autre — un peu
 * plus d'un demi-millimètre sur une A4, l'ordre de grandeur de ce qu'on voit
 * onduler sous une pointe qui va lentement. La ligne est tracée à deux cents
 * hertz, la cadence d'un Apple Pencil, et **lentement** : c'est là que le
 * tremblement se voit, et c'est là que le filtre doit travailler. Un geste vif
 * n'en a pas besoin — et n'en veut pas, le lissage se payant alors en angles
 * arrondis.
 *
 * Ce qu'on compare, c'est l'ondulation du **milieu** du trait : l'épaisseur
 * n'y entre pas, et un pixel isolé non plus.
 */
section("le tremblement d'une main lente");

const SECOUSSE = 0.003;
const droite = (y, secouee) =>
  Array.from({ length: 220 }, (_, i) => {
    const t = i / 219;
    return [0.12 + 0.16 * t, y + (secouee ? alea() * 2 * SECOUSSE : 0), 0.62 + Math.sin(i / 9) * 0.08];
  });

const Y_PROPRE = 0.12;
const Y_SECOUE = 0.3;
const gestePropre = await tracer(droite(Y_PROPRE, false), 5);
await page.waitForTimeout(500);
const gesteSecoue = await tracer(droite(Y_SECOUE, true), 5);
await page.waitForTimeout(900);

const propre = await encre(bande(Y_PROPRE));
const secoue = await encre(bande(Y_SECOUE));
const ondPropre = await ondulation(bande(Y_PROPRE));
const ondSecoue = await ondulation(bande(Y_SECOUE));
/*
 * L'ondulation qu'aurait le trait brut.
 *
 * Le tirage est uniforme entre −3 et +3 unités : son écart quadratique vaut
 * l'amplitude sur racine de trois. C'est la valeur de référence — celle que la
 * sonde mesurerait si le filtre n'existait pas.
 */
const brute = ((SECOUSSE * REND) / Math.sqrt(3)) * 1;

dire(
  "geste",
  `${Math.round(gestePropre.vitesse)} unités/s à ${Math.round(gestePropre.hz)} Hz ` +
    `(${gestePropre.duree.toFixed(2)} s), secoué ${Math.round(gesteSecoue.vitesse)} unités/s`,
);
dire(
  "ondulation du milieu du trait",
  `${ondPropre.rms.toFixed(2)} px sans tremblement, ${ondSecoue.rms.toFixed(2)} px avec — ` +
    `${brute.toFixed(2)} px si rien ne filtrait`,
);
dire("hauteur d'encre", `${propre.hauteur} px sans tremblement, ${secoue.hauteur} px avec`);
dire("tremblement divisé par", `${(brute / Math.max(0.01, ondSecoue.rms)).toFixed(1)}`);

check(propre.n > 0 && secoue.n > 0, "les deux traits sont bien posés", JSON.stringify({ propre: propre.n, secoue: secoue.n }));
check(
  ondPropre.rms < 0.6,
  "un trait sans tremblement ressort parfaitement droit (témoin)",
  `${ondPropre.rms.toFixed(2)} px d'ondulation sur un trait propre — la mesure elle-même est en cause`,
);
check(
  ondSecoue.rms < brute * 0.4,
  "et un trait qui tremble ressort presque aussi droit",
  `${ondSecoue.rms.toFixed(2)} px d'ondulation pour ${brute.toFixed(2)} injectés — sans filtre, ils passent entiers`,
);
check(
  Math.abs(secoue.largeur - propre.largeur) < propre.largeur * 0.05,
  "sans que le trait ait raccourci",
  `${secoue.largeur} px contre ${propre.largeur}`,
);

// --- 2. Les angles -------------------------------------------------------------
/*
 * Un « v » tracé vite.
 *
 * C'est là que se paie le lissage : la pointe ralentit dans l'angle, un filtre
 * dont la coupure ne suit pas la vitesse y coupe le sommet, et la lettre perd
 * sa forme. Le « sommet manqué » se mesure directement — profondeur voulue
 * contre profondeur atteinte, l'épaisseur du trait comprise dans les deux.
 *
 * Mesuré : cinq pixels manqués aujourd'hui, dix-neuf avec le réglage d'avant,
 * sur cent unités de profondeur.
 */
section("un angle vif reste vif");

const V_HAUT = 0.46;
const PROFONDEUR = 0.1;
const branche = (x0, y0, x1, y1, n) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.65];
  });
const v = [
  [0.14, V_HAUT, 0.65],
  ...branche(0.14, V_HAUT, 0.26, V_HAUT + PROFONDEUR, 12),
  ...branche(0.26, V_HAUT + PROFONDEUR, 0.38, V_HAUT, 12),
];
const gesteV = await tracer(v, 5);
await page.waitForTimeout(900);
const encreV = await encre({ min: (V_HAUT - 0.02) * REND, max: (V_HAUT + PROFONDEUR + 0.05) * REND });

const voulue = PROFONDEUR * REND;
const atteinte = encreV.maxY - V_HAUT * REND;
const manque = voulue - atteinte;
dire("geste", `${Math.round(gesteV.vitesse)} unités/s à ${Math.round(gesteV.hz)} Hz`);
dire(
  "sommet du « v »",
  `${atteinte.toFixed(0)} px de profondeur pour ${voulue.toFixed(0)} voulus, ${manque.toFixed(0)} px manqués`,
);
check(
  manque < 12,
  "le sommet d'un « v » tracé vite n'est pas raboté",
  `${manque.toFixed(0)} px manqués — une coupure qui ne suit pas la vitesse en rabote trois à quatre fois plus`,
);

// --- 3. Le retard --------------------------------------------------------------
/*
 * Le trait finit-il là où la main s'est arrêtée ?
 *
 * Un filtre traîne : le dernier point peint est en retard sur le dernier point
 * reçu. On rattrape ce retard au lever de la pointe, faute de quoi chaque
 * jambe de lettre s'arrête un peu avant sa fin — invisible sur un trait, très
 * visible sur une page.
 *
 * Le retard est **borné** par construction, à deux unités et demie environ :
 * c'est tout l'intérêt du réglage, et cela laisse à la mesure une marge
 * étroite. On regarde donc le bout, et non la longueur — deux fois moins de
 * bruit — et on demande que l'encre **atteigne** l'abscisse où la pointe s'est
 * levée. Le bout arrondi du trait la dépasse d'une demi-épaisseur quand le
 * rattrapage est là ; sans lui, elle reste en deçà.
 *
 * Et on ne la dépasse pas de beaucoup non plus : la prédiction qui compense le
 * retard à l'écran ne doit **rien** laisser dans l'encre.
 */
section("le trait rattrape la main au lever de la pointe");

/*
 * Entre les deux droites, et surtout **hors de la bande de l'arc**.
 *
 * Posé à mi-hauteur, ce trait tombait dans la bande où se mesure le cercle et
 * s'y faisait prendre pour de l'encre de l'arc : quatre-vingt-huit pixels
 * d'écart annoncés, et une sonde qui accusait l'application d'un défaut
 * qu'elle n'avait pas. Posé tout en bas, il sortait de la fenêtre : les tuiles
 * ne couvrent que ce qui est à l'écran, et la sonde ne trouvait plus rien du
 * tout. Chaque geste a sa bande, les bandes ne se recouvrent pas, et toutes
 * tiennent dans la fenêtre.
 */
const Y_VITE = 0.21;
const X0 = 0.12;
const X1 = 0.52;
/*
 * La pression **varie** : sans cela, `hasRealPressure` conclut à une valeur
 * inventée et la largeur repart sur la vitesse du geste, en s'effilant au
 * bout — on mesurerait alors l'effilement et non le retard.
 */
const geste = await tracer(
  Array.from({ length: 46 }, (_, i) => [
    X0 + (X1 - X0) * (i / 45),
    Y_VITE,
    0.62 + Math.sin(i / 7) * 0.09,
  ]),
  5,
);
await page.waitForTimeout(900);
const vite = await encre(bande(Y_VITE, 0.025));
const bout = X1 * REND;
dire("geste", `${Math.round(geste.vitesse)} unités/s à ${Math.round(geste.hz)} Hz`);
dire(
  "bout du trait",
  `${vite.maxX} px pour ${bout.toFixed(0)} tracés, soit ${(vite.maxX - bout).toFixed(1)} px au-delà`,
);
check(
  vite.maxX >= bout,
  "l'encre atteint l'abscisse où la pointe s'est levée",
  `${vite.maxX} px pour ${bout.toFixed(0)} — sans rattrapage, le filtre s'arrête deux unités avant`,
);
check(
  vite.maxX < bout + 6 * U,
  "et ne va pas au-delà",
  `${vite.maxX} px pour ${bout.toFixed(0)} — une prédiction laissée dans l'encre le ferait`,
);
check(
  Math.abs(vite.minX - X0 * REND) < 6 * U,
  "et elle part de là où la pointe s'est posée",
  `${vite.minX} px pour ${(X0 * REND).toFixed(0)}`,
);

// --- 4. Les trous ---------------------------------------------------------------
/*
 * Un demi-cercle à la souris, en cinq points.
 *
 * Soixante hertz et un geste rapide : c'est tout ce que laisse une souris, et
 * c'est le cas où la corde se voit. Cinq points sur un demi-cercle, ce sont
 * des cordes de quarante-cinq degrés, qui passent vingt-six pixels en deçà de
 * l'arc — un polygone, pas une courbe.
 *
 * La courbe ne rend pas le cercle exactement, et ne le peut pas : elle ne sait
 * pas que c'en est un. Elle divise l'écart par deux, et par cinq dès que les
 * points sont deux fois plus serrés. C'est ce rapport qu'on mesure, pas une
 * perfection qui n'aurait pas de sens.
 */
section("un geste à la souris reste une courbe");

const CX = 0.35;
const CY = 0.78;
const R = 0.16;
const arc = Array.from({ length: 5 }, (_, i) => {
  const a = Math.PI + (i / 4) * Math.PI;
  return [CX - R * Math.cos(a), CY + R * Math.sin(a), 0.5];
});
await tracer(arc, 16, "mouse");
await page.waitForTimeout(900);
const courbe = await rayons(
  { min: (CY - R - 0.04) * REND, max: (CY + 0.03) * REND },
  CX * REND,
  CY * REND,
);
const corde = R * (1 - Math.cos(Math.PI / 8)) * REND;
const ecart = R * REND - courbe.mini;
dire(
  "écart au cercle",
  `${ecart.toFixed(0)} px vers l'intérieur — la corde en donnerait ${corde.toFixed(0)}`,
);
check(Number.isFinite(courbe.mini), "l'arc est bien posé", JSON.stringify(courbe));
check(
  ecart < corde * 0.65,
  "les trous entre deux points sont comblés par une courbe, pas par une corde",
  `${ecart.toFixed(0)} px d'écart pour ${corde.toFixed(0)} qu'en donnerait la corde`,
);

// --- 5. Le coût -----------------------------------------------------------------
/*
 * Le filtre ne doit rien coûter.
 *
 * Il tourne deux cents fois par seconde, sur le chemin le plus sensible de
 * l'application. Deux multiplications par point et par axe, c'est ce qu'il
 * promet ; on le vérifie plutôt que de le croire.
 */
section("le lissage ne coûte rien");

const cout = await page.evaluate(async () => {
  const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
  const r = el.getBoundingClientRect();
  const fire = (t, x, y, p, b) =>
    el.dispatchEvent(
      new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 21, pointerType: "pen",
        isPrimary: true, pressure: p, buttons: b,
        clientX: r.left + r.width * x, clientY: r.top + r.width * y,
      }),
    );
  let passe = 0;
  fire("pointerdown", 0.1, 1.05, 0.6, 1);
  for (let i = 1; i < 400; i++) {
    const t0 = performance.now();
    fire("pointermove", 0.1 + i * 0.0018, 1.05 + Math.sin(i / 7) * 0.01, 0.6 + Math.sin(i / 5) * 0.08, 1);
    passe += performance.now() - t0;
    if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
  }
  fire("pointerup", 0.82, 1.05, 0, 0);
  return passe / 399;
});
dire("temps passé dans le gestionnaire", `${cout.toFixed(3)} ms par point`);
check(cout < 0.5, "un point filtré coûte moins d'un demi-millième de seconde", `${cout.toFixed(3)} ms`);

await page.waitForTimeout(1200);
console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
await browser.close();
process.exit(ko === 0 ? 0 : 1);
