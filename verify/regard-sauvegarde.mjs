/*
 * La pastille d'enregistrement, dans chacun de ses états — mesurée et
 * photographiée, en clair et en sombre, sur téléphone et en desktop.
 *
 * `audit.mjs` ne la voit pas : il saute les éléments qui ont des enfants (elle
 * porte une icône, un libellé et un compteur) et ceux dont l'opacité est nulle
 * (elle s'efface après « Enregistré »). Un élément qui n'apparaît que sous
 * condition doit recevoir son propre scénario, sinon il n'est jamais examiné.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";

let echecs = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

/* Chromium rend les couleurs calculées en `oklch()` : les lire comme du RGB
   donne des rapports absurdes. On passe par un canevas, qui les convertit. */
/* Une expression auto-appelée, et non une fonction : passée en chaîne,
   `page.evaluate` l'évalue telle quelle et n'y transmet aucun argument — le
   sélecteur est donc écrit dedans. */
const MESURE = `(() => {
  const el = document.querySelector('[data-testid="etat-sauvegarde"]');
  if (!el) return null;
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
  const bgOf = (n) => {
    for (; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
    }
    return getComputedStyle(document.body).backgroundColor || "#fff";
  };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    texte: el.textContent.trim(),
    contraste: ratio(toRgb(cs.color), toRgb(bgOf(el))),
    hauteur: r.height,
    largeur: r.width,
    droite: r.right,
    opacite: Number(cs.opacity),
    // Ce qui se trouve réellement sous son centre : une pastille recouverte
    // par la barre de navigation ne se toucherait pas.
    dessus: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-testid="etat-sauvegarde"]') === el,
  };
})()`;

/*
 * « Hors ligne » et « Reprise en cours » ne sont pas le même état, et c'est
 * voulu : une requête qui échoue sur un réseau présent n'a pas la même suite
 * qu'un appareil sans réseau. Le premier se produit en coupant la requête, le
 * second en coupant vraiment le réseau du contexte.
 */
const ETATS = [
  { nom: "enregistre", attendu: "Enregistré", reponse: null },
  { nom: "reprise", attendu: "Reprise en cours", reponse: "abort" },
  { nom: "hors-ligne", attendu: "Hors ligne", reponse: null, coupure: true },
  { nom: "session", attendu: "Session expirée", reponse: 401 },
  { nom: "refus", attendu: "Non enregistré", reponse: 413 },
];

const browser = await chromium.launch();

for (const { ecran, width, height } of [
  { ecran: "telephone", width: 393, height: 852 },
  { ecran: "desktop", width: 1194, height: 900 },
]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();

    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nouvelle note" }).first().click();
    await page.waitForURL(/\/notes\/[a-z0-9]+/);
    const titre = `Pastille ${ecran} ${theme} ${Date.now()}`;
    await page.getByLabel("Titre de la note").fill(titre);
    await page.getByLabel("Titre de la note").blur();
    await page.waitForSelector('[data-testid="drawing-canvas"]');
    await page.waitForTimeout(500);

    let mode = null;
    await page.route("**/api/notes/*/blocks/*", (route) => {
      if (mode === "abort") return route.abort("failed");
      if (typeof mode === "number") {
        return route.fulfill({
          status: mode,
          contentType: "application/json",
          body: '{"error":"Ce bloc est trop volumineux pour être enregistré."}',
        });
      }
      return route.fallback();
    });

    const canvas = page.locator('[data-testid="drawing-canvas"]').last();
    let y = 0.1;
    for (const etat of ETATS) {
      mode = etat.reponse;
      if (etat.coupure) await ctx.setOffline(true);
      y += 0.06;
      // Un trait, pour déclencher un enregistrement dans l'état voulu.
      await canvas.evaluate((el, yy) => {
        const r = el.getBoundingClientRect();
        const fire = (t, x, p, b) =>
          el.dispatchEvent(new PointerEvent(t, {
            bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen",
            isPrimary: true, pressure: p, buttons: b,
            clientX: r.left + r.width * x, clientY: r.top + r.width * yy,
          }));
        fire("pointerdown", 0.2, 0.5, 1);
        for (let i = 1; i < 12; i++) fire("pointermove", 0.2 + i * 0.04, 0.45, 1);
        fire("pointerup", 0.7, 0, 0);
      }, y);
      await page.waitForTimeout(etat.reponse === null ? 1600 : 2400);

      const m = await page.evaluate(MESURE);
      const ou = `${ecran} ${theme} ${etat.nom}`;
      if (!m) {
        check(false, `${ou} : pastille introuvable`);
        continue;
      }
      check(m.texte.includes(etat.attendu), `${ou} : dit « ${etat.attendu} »`, m.texte);
      check(m.contraste >= 4.5, `${ou} : contraste`, m.contraste.toFixed(2));
      check(m.hauteur >= 44, `${ou} : cible tactile`, `${Math.round(m.hauteur)} px`);
      check(m.droite <= width, `${ou} : ne déborde pas`, `${Math.round(m.droite)} / ${width}`);
      check(m.dessus, `${ou} : rien ne la recouvre`);

      await page.screenshot({
        path: `shots/sauvegarde-${ecran}-${theme}-${etat.nom}.png`,
        clip: { x: 0, y: height - 220, width, height: 220 },
      });
      if (etat.coupure) {
        await ctx.setOffline(false);
        // Le retour du réseau relance la file : on la laisse finir avant de
        // mesurer l'état suivant.
        await page.waitForTimeout(1200);
      }
    }

    // Le panneau de secours, ouvert : c'est lui qu'on lit quand ça ne passe plus.
    await page.locator('[data-testid="etat-sauvegarde"]').click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/sauvegarde-${ecran}-${theme}-panneau.png` });
    await page.keyboard.press("Escape");

    // Ménage : la note d'essai ne reste pas dans la base.
    await page.unroute("**/api/notes/*/blocks/*");
    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    const carte = page.locator(`text=${titre}`).first();
    if (await carte.count()) {
      await carte.click({ button: "right" });
      const supprimer = page.getByRole("menuitem", { name: /Supprimer/ });
      if (await supprimer.count()) {
        await supprimer.click();
        const ok = page.getByRole("button", { name: "Supprimer", exact: true });
        if (await ok.count()) await ok.click();
        await page.waitForTimeout(600);
      }
    }
    check((await page.locator(`text=${titre}`).count()) === 0, `${ecran} ${theme} : note d'essai retirée`);
    await ctx.close();
  }
}

await browser.close();
console.log(echecs === 0 ? "\n✅ pastille mesurée dans tous ses états" : `\n❌ ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
