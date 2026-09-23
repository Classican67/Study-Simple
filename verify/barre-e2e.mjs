/*
 * La barre d'outils : les instruments, et le support qui les porte.
 *
 * Deux choses à prouver, et elles n'ont rien à voir l'une avec l'autre.
 *
 * **Les instruments écrivent vraiment autrement.** Cinq silhouettes dans une
 * barre ne coûtent rien à dessiner, et ne valent rien si la plume, le crayon
 * et le feutre posent le même trait. On trace donc un trait par instrument,
 * chacun sur sa bande, et on lit les pixels : l'épaisseur, l'opacité, le grain
 * du bord, l'effilement du bout. Ce sont quatre grandeurs différentes, et
 * chaque instrument doit se reconnaître à la sienne.
 *
 * **Le support obéit.** La barre se déplace aux quatre bords, se replie en
 * bulle, et retrouve sa place au rechargement. Trois choses s'y cassent
 * facilement : elle sort de l'écran quand on la lâche près d'un coin, elle se
 * rouvre toute seule quand on la referme par son propre bouton, et collée à un
 * bord vertical elle déborde de sa colonne sans rien signaler.
 *
 * Et comme la barre n'existe qu'ouverte — et sous trois formes — `audit.mjs`
 * ne la mesure jamais : contraste, cibles de 44 px et débordement se mesurent
 * ici, en clair et en sombre, sur téléphone et en desktop.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
let ko = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — ${extra}`}`);
  if (!ok) ko++;
};
const dire = (label, valeur) => console.log(`   ${label} : ${valeur}`);
const section = (t) => console.log(`\n── ${t} ──`);
const sql = (q) => execFileSync("sqlite3", ["verif.db", q]).toString().trim();

const browser = await chromium.launch();

/** Une note neuve, page manuscrite ouverte. */
async function nouvelleNote(ctx, titre) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    console.log("   erreur page :", String(e).slice(0, 180));
    ko++;
  });
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle note" }).click();
  await page.waitForURL(/\/notes\/[a-z0-9]+/);
  await page.getByLabel("Titre de la note").fill(titre);
  await page.getByLabel("Titre de la note").blur();
  await page.waitForSelector('[data-testid="drawing-canvas"]');
  await page.waitForTimeout(600);
  return page;
}

/** Trace un trait droit au stylet, à cadence maîtrisée. */
const tracer = (page, y, x0 = 0.12, x1 = 0.8) =>
  page.evaluate(
    async ({ y, x0, x1 }) => {
      const el = [...document.querySelectorAll('[data-testid="drawing-canvas"]')].at(-1);
      const r = el.getBoundingClientRect();
      const fire = (t, x, p, b) =>
        el.dispatchEvent(
          new PointerEvent(t, {
            bubbles: true, cancelable: true, pointerId: 31, pointerType: "pen",
            isPrimary: true, pressure: p, buttons: b,
            clientX: r.left + r.width * x, clientY: r.top + r.width * y,
          }),
        );
      const attendre = (jusque) => {
        while (performance.now() < jusque) {
          /* l'attente elle-même : un filtre en temps réel a besoin de vrais
             horodatages, cf. souplesse-e2e.mjs */
        }
      };
      const n = 90;
      const t0 = performance.now();
      fire("pointerdown", x0, 0.62, 1);
      for (let i = 1; i <= n; i++) {
        attendre(t0 + i * 5);
        fire("pointermove", x0 + ((x1 - x0) * i) / n, 0.62 + Math.sin(i / 8) * 0.06, 1);
      }
      fire("pointerup", x1, 0, 0);
      await new Promise((res) => requestAnimationFrame(res));
    },
    { y, x0, x1 },
  );

/**
 * Ce que l'encre laisse dans une bande : son profil.
 *
 * Quatre grandeurs, parce que quatre choses distinguent les instruments —
 * l'épaisseur, l'opacité, le grain du bord, l'effilement du bout.
 */
const profil = (page, bande) =>
  page.evaluate((bande) => {
    const colonnes = new Map();
    let alphaMax = 0;
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
          const a = data[(py * c.width + px) * 4 + 3];
          if (a <= 8) continue;
          alphaMax = Math.max(alphaMax, a);
          const col = colonnes.get(px) ?? { haut: y, bas: y };
          col.haut = Math.min(col.haut, y);
          col.bas = Math.max(col.bas, y);
          colonnes.set(px, col);
        }
      }
    }
    const cles = [...colonnes.keys()].sort((a, b) => a - b);
    if (cles.length < 20) return { n: cles.length, largeurRendu };
    const largeurs = cles.map((k) => colonnes.get(k).bas - colonnes.get(k).haut + 1);
    const coeur = largeurs.slice(
      Math.round(largeurs.length * 0.2),
      Math.round(largeurs.length * 0.8),
    );
    const moyenne = coeur.reduce((s, v) => s + v, 0) / coeur.length;

    /*
     * Le grain : à quel point le bord **supérieur** tremble d'une colonne à la
     * suivante. On le prend sur le bord et non sur la largeur : une largeur qui
     * varie, c'est la pression ; un bord qui tremble, c'est la mine.
     */
    const bords = cles.map((k) => colonnes.get(k).haut);
    let grain = 0;
    for (let i = 1; i + 1 < bords.length; i++) {
      grain += Math.abs(bords[i] - (bords[i - 1] + bords[i + 1]) / 2);
    }
    grain /= Math.max(1, bords.length - 2);

    return {
      n: cles.length,
      largeurRendu,
      epaisseur: moyenne,
      // Le bout : la deuxième colonne d'encre, rapportée au corps du trait.
      bout: largeurs[1] / moyenne,
      alpha: alphaMax / 255,
      grain,
    };
  }, bande);

// =============================================================================
section("chaque instrument pose un trait différent");

const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
const page = await nouvelleNote(ctx, `Barre ${Date.now()}`);

const INSTRUMENTS = ["Plume", "Stylo", "Crayon", "Feutre", "Surligneur"];
const BANDES = { Plume: 0.1, Stylo: 0.2, Crayon: 0.3, Feutre: 0.42, Surligneur: 0.56 };
const mesures = {};

for (const nom of INSTRUMENTS) {
  await page.getByRole("button", { name: nom, exact: true }).first().click();
  await page.waitForTimeout(150);
  await tracer(page, BANDES[nom]);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(900);

const REND = (await profil(page, { min: 0, max: 1e9 })).largeurRendu;
for (const nom of INSTRUMENTS) {
  const y = BANDES[nom] * REND;
  mesures[nom] = await profil(page, { min: y - 0.05 * REND, max: y + 0.05 * REND });
  const m = mesures[nom];
  dire(
    nom,
    m.epaisseur
      ? `${m.epaisseur.toFixed(1)} px d'épaisseur, opacité ${m.alpha.toFixed(2)}, grain ${m.grain.toFixed(2)}, bout ${(m.bout * 100).toFixed(0)} %`
      : `rien de posé (${m.n} colonnes)`,
  );
}

check(
  INSTRUMENTS.every((n) => mesures[n].n > 50),
  "les cinq traits sont posés",
  JSON.stringify(Object.fromEntries(INSTRUMENTS.map((n) => [n, mesures[n].n]))),
);
check(
  mesures.Feutre.epaisseur > mesures.Stylo.epaisseur * 1.5,
  "le feutre écrit plus large que le stylo",
  `${mesures.Feutre.epaisseur?.toFixed(1)} contre ${mesures.Stylo.epaisseur?.toFixed(1)}`,
);
check(
  mesures.Surligneur.epaisseur > mesures.Feutre.epaisseur * 1.4,
  "et le surligneur plus large que le feutre",
  `${mesures.Surligneur.epaisseur?.toFixed(1)} contre ${mesures.Feutre.epaisseur?.toFixed(1)}`,
);
check(
  mesures.Crayon.alpha < mesures.Stylo.alpha - 0.08,
  "le crayon est plus pâle que le stylo",
  `${mesures.Crayon.alpha?.toFixed(2)} contre ${mesures.Stylo.alpha?.toFixed(2)}`,
);
check(
  mesures.Surligneur.alpha < 0.45,
  "et le surligneur laisse lire ce qu'il couvre",
  `opacité ${mesures.Surligneur.alpha?.toFixed(2)}`,
);
check(
  mesures.Crayon.grain > mesures.Stylo.grain * 1.6,
  "le crayon a le grain d'une mine, le stylo un bord net",
  `${mesures.Crayon.grain?.toFixed(2)} contre ${mesures.Stylo.grain?.toFixed(2)}`,
);
check(
  mesures.Plume.bout < 0.6 && mesures.Feutre.bout > 0.85,
  "la plume s'effile, le feutre a le bout carré",
  `plume ${(mesures.Plume.bout * 100).toFixed(0)} %, feutre ${(mesures.Feutre.bout * 100).toFixed(0)} %`,
);

// --- Ce qui est enregistré ---------------------------------------------------
section("l'instrument est enregistré avec le trait");

await page.waitForTimeout(1200);
const noteId = page.url().split("/").pop();
const contenu = sql(
  `select content from NoteBlock where noteId='${noteId}' and kind='drawing' order by position limit 1;`,
);
const outils = [...contenu.matchAll(/"tool":"(\w+)"/g)].map((m) => m[1]);
dire("en base", outils.join(", ") || "(aucun)");
check(
  ["fountain", "pen", "pencil", "marker", "highlighter"].every((t) => outils.includes(t)),
  "les cinq instruments sont dans la note enregistrée",
  outils.join(", "),
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const apres = await profil(page, {
  min: BANDES.Crayon * REND - 0.05 * REND,
  max: BANDES.Crayon * REND + 0.05 * REND,
});
dire("crayon rechargé", `opacité ${apres.alpha?.toFixed(2)}, grain ${apres.grain?.toFixed(2)}`);
check(
  apres.alpha !== undefined && Math.abs(apres.alpha - mesures.Crayon.alpha) < 0.05,
  "et le crayon rouvert est toujours un crayon",
  `${apres.alpha?.toFixed(2)} contre ${mesures.Crayon.alpha?.toFixed(2)}`,
);
check(
  apres.grain !== undefined && apres.grain > mesures.Stylo.grain + 0.05,
  "avec le même grain : il ne frémit pas d'un chargement à l'autre",
  `grain ${apres.grain?.toFixed(2)}`,
);

// --- Les réglages suivent l'instrument ---------------------------------------
section("chaque instrument garde ses réglages");

await page.getByRole("button", { name: "Feutre", exact: true }).first().click();
await page.getByRole("button", { name: "Vert", exact: true }).first().click();
await page.getByRole("button", { name: "Épais", exact: true }).first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Stylo", exact: true }).first().click();
await page.waitForTimeout(200);
const styloVert = await page.getByRole("button", { name: "Vert", exact: true }).first().getAttribute("aria-pressed");
await page.getByRole("button", { name: "Feutre", exact: true }).first().click();
await page.waitForTimeout(200);
const feutreVert = await page.getByRole("button", { name: "Vert", exact: true }).first().getAttribute("aria-pressed");
const feutreEpais = await page.getByRole("button", { name: "Épais", exact: true }).first().getAttribute("aria-pressed");
check(styloVert !== "true", "passer au stylo ne lui donne pas la couleur du feutre", String(styloVert));
check(
  feutreVert === "true" && feutreEpais === "true",
  "et revenir au feutre le retrouve vert et épais",
  `${feutreVert} / ${feutreEpais}`,
);

// =============================================================================
section("la barre se déplace, et s'en souvient");

await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
await page.waitForSelector('[data-testid="barre-flottante"]');
await page.waitForTimeout(500);

/** Glisse la poignée jusqu'à un point de l'écran, en Pointer Events. */
async function glisser(page, x, y) {
  const poignee = page.locator('[data-testid="barre-poignee"]');
  const r = await poignee.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  // La barre passe de rangée à colonne : on la laisse se réagencer avant de
  // la mesurer, sinon on mesure un état intermédiaire.
  await page.waitForTimeout(900);
}

const cadre = () => page.locator('[data-testid="barre-flottante"]').boundingBox();
const dedans = (b, vp) => b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
const VP = { width: 1194, height: 900 };

for (const [nom, x, y] of [
  ["en haut à gauche", 40, 30],
  ["à droite", 1170, 450],
  ["en bas à droite", 1150, 870],
  ["à gauche", 20, 500],
]) {
  await glisser(page, x, y);
  const b = await cadre();
  dire(nom, `${Math.round(b.x)},${Math.round(b.y)} — ${Math.round(b.width)}×${Math.round(b.height)}`);
  check(dedans(b, VP), `lâchée ${nom}, la barre reste entière à l'écran`, JSON.stringify(b));
}

// Collée à gauche, elle est devenue une colonne : c'est là qu'elle débordait.
const colonne = await cadre();
check(
  colonne.width < 200,
  "collée à un bord vertical, la barre est une colonne étroite",
  `${Math.round(colonne.width)} px de large`,
);
const debordants = await page.evaluate(() => {
  const barre = document.querySelector('[data-testid="barre-flottante"]');
  const r = barre.getBoundingClientRect();
  return [...barre.querySelectorAll("button")]
    .filter((b) => {
      const c = b.getBoundingClientRect();
      return c.width > 0 && (c.left < r.left - 1 || c.right > r.right + 1);
    })
    .map((b) => b.getAttribute("aria-label"));
});
check(
  debordants.length === 0,
  "et aucun bouton n'en sort par les côtés",
  debordants.slice(0, 4).join(", "),
);

// La place est gardée d'un rechargement à l'autre.
await page.keyboard.press("Escape");
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
await page.waitForSelector('[data-testid="barre-flottante"]');
await page.waitForTimeout(600);
const rouverte = await cadre();
dire("après rechargement", `${Math.round(rouverte.x)},${Math.round(rouverte.y)}`);
check(
  rouverte.x < 200,
  "la barre retrouve le bord où on l'avait laissée",
  `x = ${Math.round(rouverte.x)}`,
);

// =============================================================================
section("la bulle");

await page.getByRole("button", { name: "Déplacer la barre d'outils" }).click();
await page.getByRole("menuitemradio", { name: "En bas" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Crayon", exact: true }).first().click();
await page.getByRole("button", { name: "Réduire les outils en bulle" }).click();
await page.waitForTimeout(500);

check(
  (await page.locator('[data-testid="barre-flottante"]').count()) === 0,
  "repliée, la barre laisse la place à la feuille",
);
const bulle = page.getByRole("button", { name: "Ouvrir les outils d'écriture" });
check(await bulle.isVisible(), "et il reste une bulle");
const dansLaBulle = await bulle.evaluate((b) => b.querySelector("svg")?.outerHTML.length ?? 0);
check(dansLaBulle > 0, "qui montre l'instrument en cours");

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Écrire en plein écran" }).first().click();
await page.waitForTimeout(700);
check(
  await page.getByRole("button", { name: "Ouvrir les outils d'écriture" }).isVisible(),
  "elle est encore repliée au rechargement",
);
await page.getByRole("button", { name: "Ouvrir les outils d'écriture" }).click();
await page.waitForTimeout(500);
check(
  (await page.locator('[data-testid="barre-flottante"]').count()) === 1,
  "et la toucher rouvre la barre",
);

// Son propre bouton la referme : le clic « dehors » et la bascule s'ajoutaient.
await page.getByRole("button", { name: "Déplacer la barre d'outils" }).click();
await page.waitForTimeout(250);
check(
  await page.getByRole("menu", { name: "Placer la barre d'outils" }).isVisible(),
  "la poignée ouvre le choix du bord au clavier comme au doigt",
);
await page.getByRole("button", { name: "Déplacer la barre d'outils" }).click();
await page.waitForTimeout(250);
check(
  (await page.getByRole("menu", { name: "Placer la barre d'outils" }).count()) === 0,
  "et le referme",
  "rouvert aussitôt : le clic « dehors » et la bascule se sont additionnés",
);

await ctx.close();

// =============================================================================
section("mesures : contraste, cibles, débordement");

const MESURER = `
(() => {
  const barre = document.querySelector('[data-testid="barre-flottante"]')
    || document.querySelector('[role="toolbar"]');
  if (!barre) return { absent: true };
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRgb = (color) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
    }
    return getComputedStyle(document.body).backgroundColor || "#fff";
  };

  const contrastes = [];
  for (const el of barre.querySelectorAll("span,p,button")) {
    const texte = String(el.textContent ?? "").trim();
    if (!texte || el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const v = ratio(toRgb(cs.color), toRgb(bgOf(el)));
    if (v < 4.5) contrastes.push({ texte: texte.slice(0, 20), v: v.toFixed(2) });
  }

  const petits = [];
  const recouverts = [];
  const barreRect = barre.getBoundingClientRect();
  for (const b of barre.querySelectorAll("button")) {
    const r = b.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.width < 44 || r.height < 44) {
      petits.push({ nom: (b.getAttribute("aria-label") ?? "?").slice(0, 22), taille: Math.round(r.width) + "x" + Math.round(r.height) });
    }
    /*
     * Rien ne doit se poser sur un bouton : ni la barre de navigation du
     * téléphone, ni la pastille d'enregistrement, ni le repère de page.
     *
     * Deux exceptions, et ce sont des faux positifs de la mesure, pas des
     * défauts : un bouton **désactivé** ne reçoit pas les pointeurs — c'est
     * voulu, Annuler grisé ne doit rien faire — et un bouton **sorti de la
     * partie visible** de la colonne défilante est derrière son propre
     * conteneur, ce qui est le propre d'un défilement.
     */
    if (b.disabled) continue;
    const dedansLaBarre = r.top >= barreRect.top - 1 && r.bottom <= barreRect.bottom + 1;
    if (!dedansLaBarre) continue;
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (dessus && !b.contains(dessus) && dessus !== b) {
      recouverts.push((b.getAttribute("aria-label") ?? "?").slice(0, 22));
    }
  }

  const r = barre.getBoundingClientRect();
  return {
    contrastes,
    petits,
    recouverts,
    boutons: barre.querySelectorAll("button").length,
    horsEcran: Math.max(0, Math.round(r.right - document.documentElement.clientWidth), Math.round(-r.left), Math.round(r.bottom - window.innerHeight), Math.round(-r.top)),
    pageDeborde: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
})()
`;

for (const [nom, vp, dark, gauche] of [
  ["téléphone clair", { width: 393, height: 852 }, false, false],
  ["téléphone sombre", { width: 393, height: 852 }, true, false],
  ["desktop clair", { width: 1194, height: 900 }, false, false],
  ["desktop sombre", { width: 1194, height: 900 }, true, false],
  ["colonne clair", { width: 1194, height: 900 }, false, true],
  ["colonne sombre", { width: 393, height: 852 }, true, true],
]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, colorScheme: dark ? "dark" : "light" });
  await c.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const p = await nouvelleNote(c, `Mesure ${nom} ${Date.now()}`);
  await p.evaluate(() => document.fonts.ready);
  await p.getByRole("button", { name: "Écrire en plein écran" }).first().click();
  await p.waitForSelector('[data-testid="barre-flottante"]');
  if (gauche) {
    await p.getByRole("button", { name: "Déplacer la barre d'outils" }).click();
    await p.getByRole("menuitemradio", { name: "À gauche" }).click();
  }
  await p.waitForTimeout(700);
  const m = await p.evaluate(MESURER);
  if (m.absent) {
    check(false, `${nom} — la barre est là`, "introuvable");
  } else {
    dire(nom, `${m.boutons} boutons`);
    check(m.contrastes.length === 0, `${nom} — tout se lit`, JSON.stringify(m.contrastes));
    check(m.petits.length === 0, `${nom} — chaque commande fait 44 px`, JSON.stringify(m.petits.slice(0, 5)));
    check(m.recouverts.length === 0, `${nom} — rien ne se pose sur les commandes`, m.recouverts.slice(0, 5).join(", "));
    check(m.horsEcran === 0, `${nom} — la barre tient dans l'écran`, `${m.horsEcran} px dehors`);
    check(!m.pageDeborde, `${nom} — et la page ne défile pas en largeur`);
  }
  await c.close();
}

await browser.close();
console.log(ko === 0 ? "\nTout passe." : `\n${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
