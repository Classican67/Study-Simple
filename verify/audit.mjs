/*
 * Audit d'accessibilité et de cohérence visuelle.
 *
 * Trois sondes :
 *  - contraste WCAG AA (4.5:1, ou 3:1 pour le grand texte) ;
 *  - cibles tactiles d'au moins 44 px ;
 *  - cohérence des positions : une classe `absolute` doit produire un
 *    `position: absolute`. Une règle maison déclarée après les utilitaires de
 *    Tailwind l'écrasait sans que rien ne le montre.
 *
 * L'audit ne voit que les états qu'il visite : un élément qui n'apparaît que
 * sous condition a besoin de son propre scénario.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const { token, deckId } = JSON.parse(readFileSync("ctx.json", "utf8"));
const BASE = "http://localhost:3100";
const problems = [];

// Chromium renvoie les couleurs calculées en `oklch()`. Les lire comme du RGB
// donne des rapports absurdes : on passe par un canevas, qui les convertit.
const CONTRAST = `
(() => {
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

  const out = [];
  for (const el of document.querySelectorAll("h1,h2,h3,p,span,a,button,label,li,dd,dt,kbd,td,th,input")) {
    // La propriete value n'est une chaine que sur un champ de saisie : sur un
    // li, c'est un nombre, et trim() n'y existe pas.
    const brut = el instanceof HTMLInputElement ? el.value : el.textContent;
    const text = String(brut ?? "").trim();
    if (!text || el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const value = ratio(toRgb(cs.color), toRgb(bgOf(el)));
    if (value < need) out.push({ text: text.slice(0, 30), ratio: value.toFixed(2), need });
  }
  return out;
})()
`;

const TOUCH = `
(() => {
  const out = [];
  for (const el of document.querySelectorAll("button,a,[role=button],input[type=checkbox],[role=switch]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || cs.pointerEvents === "none") continue;
    // La cible, au sens de WCAG, est la zone qui ACTIVE le contrôle. Une case
    // de 20 px enveloppee dans une etiquette pleine largeur se coche en
    // touchant l'etiquette : c'est elle qu'il faut mesurer.
    let zone = r;
    if (el.tagName === "INPUT") {
      const etiquette = el.closest("label") || document.querySelector('label[for="' + el.id + '"]');
      if (etiquette) {
        const er = etiquette.getBoundingClientRect();
        if (er.width * er.height > zone.width * zone.height) zone = er;
      }
    }

    if (zone.width < 44 || zone.height < 44) {
      out.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30),
        size: Math.round(zone.width) + "x" + Math.round(zone.height),
      });
    }
  }
  return out;
})()
`;

const POSITION = `
(() => {
  const out = [];
  const attendu = { absolute: "absolute", fixed: "fixed", sticky: "sticky", relative: "relative" };
  for (const el of document.querySelectorAll("[class]")) {
    const classes = (el.getAttribute("class") || "").split(/\\s+/);
    const voulu = classes.map((c) => attendu[c]).filter(Boolean).pop();
    if (!voulu) continue;
    const reel = getComputedStyle(el).position;
    if (reel !== voulu) {
      out.push({
        voulu,
        reel,
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30),
      });
    }
  }
  return out;
})()
`;

const browser = await chromium.launch();

async function audit(label, vp, path, dark, act) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "fiches_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (act) await act(page).catch((e) => problems.push(`  [scénario]  ${label} : ${String(e).slice(0, 80)}`));
  await page.waitForTimeout(300);

  for (const c of await page.evaluate(CONTRAST)) {
    problems.push(`  [contraste] ${label} : « ${c.text} » ${c.ratio}:1 (min ${c.need})`);
  }
  for (const t of await page.evaluate(TOUCH)) {
    problems.push(`  [tactile]   ${label} : « ${t.label} » ${t.size}`);
  }
  for (const p of await page.evaluate(POSITION)) {
    problems.push(`  [position]  ${label} : « ${p.label} » demande ${p.voulu}, obtient ${p.reel}`);
  }
  await ctx.close();
}

const phone = { width: 393, height: 852 };
const desktop = { width: 1280, height: 800 };

await audit("accueil clair", phone, "/", false);
await audit("accueil sombre", phone, "/", true);
await audit("accueil desktop", desktop, "/", false);
await audit("paquet clair", phone, `/decks/${deckId}`, false);
await audit("paquet sombre", phone, `/decks/${deckId}`, true);
await audit("révision clair", phone, `/decks/${deckId}/study?all=1`, false);
await audit("révision sombre", phone, `/decks/${deckId}/study?all=1`, true);
await audit("mode écrire", phone, `/decks/${deckId}/study?all=1&mode=write`, false);
await audit("connexion", phone, "/login", false);

// Les réglages de révision n'existent que dépliés.
const openStudyOptions = async (p) => {
  await p.getByRole("button", { name: "Options de révision" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(400);
};
await audit("options révision clair", phone, `/decks/${deckId}/study?all=1`, false, openStudyOptions);
await audit("options révision sombre", phone, `/decks/${deckId}/study?all=1`, true, openStudyOptions);

// Le sens inverse rend la question par un tout autre composant.
const reverseSide = async (p) => {
  await p.getByRole("button", { name: "Options de révision" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.getByRole("button", { name: "Définition", exact: true }).click();
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
};
await audit("sens inverse clair", phone, `/decks/${deckId}/study?all=1`, false, reverseSide);
await audit("sens inverse sombre", phone, `/decks/${deckId}/study?all=1`, true, reverseSide);

// La recherche AVEC du texte saisi : la croix d'effacement n'existe qu'alors.
const openSearch = async (p) => {
  await p.locator('button[aria-label^="Rechercher"]').first().click();
  await p.waitForSelector('input[aria-label="Rechercher"]');
  await p.locator('input[aria-label="Rechercher"]').fill("mit");
  await p.waitForTimeout(700);
};
await audit("recherche clair", phone, `/decks/${deckId}`, false, openSearch);
await audit("recherche sombre", phone, `/decks/${deckId}`, true, openSearch);
await audit("recherche globale", desktop, "/", false, openSearch);

// L'export : trois liens de téléchargement dans une feuille.
const openExport = async (p) => {
  await p.getByRole("button", { name: "Exporter" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(300);
};
await audit("export clair", phone, "/", false, openExport);
await audit("export sombre", phone, "/", true, openExport);

// Le regroupement en alias : cases, interrupteur, liste défilante, annonce.
const openGroup = async (p) => {
  await p.getByRole("button", { name: "Regrouper" }).click();
  await p.waitForSelector('[role="dialog"]');
  await p.waitForTimeout(800);
};
await audit("regroupement clair", phone, "/", false, openGroup);
await audit("regroupement sombre", phone, "/", true, openGroup);
await audit("regroupement desktop", desktop, "/", false, openGroup);

// Les notes : la liste, puis un éditeur portant les trois types de blocs.
await audit("notes liste clair", phone, "/notes", false);
await audit("notes liste sombre", phone, "/notes", true);

// Autonome : s'il n'y a pas de note, on en crée une, et on s'assure que les
// trois types de blocs sont présents — c'est tout l'objet du scénario.
const openNote = async (p) => {
  if ((await p.locator('a[href^="/notes/"]').count()) === 0) {
    await p.getByRole("button", { name: "Nouvelle note" }).click();
    await p.waitForURL(/\/notes\/[a-z0-9]+/);
  } else {
    await p.locator('a[href^="/notes/"]').first().click();
  }
  await p.waitForSelector("section[aria-label^='Bloc']");

  if ((await p.locator("table").count()) === 0) {
    await p.getByRole("button", { name: "Tableau", exact: true }).last().click();
    await p.waitForSelector("table");
  }
  if ((await p.locator('[data-testid="drawing-canvas"]').count()) === 0) {
    await p.getByRole("button", { name: "Croquis", exact: true }).last().click();
    await p.waitForSelector('[data-testid="drawing-canvas"]');
  }
  await p.waitForTimeout(500);
};
await audit("note éditeur clair", phone, "/notes", false, openNote);
await audit("note éditeur sombre", phone, "/notes", true, openNote);
await audit("note éditeur desktop", desktop, "/notes", false, openNote);

// La roue chromatique n'existe qu'ouverte : sans son propre passage, l'audit ne
// la verrait jamais.
const openWheel = async (p) => {
  await openNote(p);
  await p.getByRole("button", { name: "Autre couleur" }).first().click();
  await p.getByRole("dialog", { name: "Choisir une couleur" }).waitFor();
  await p.waitForTimeout(400);
};
await audit("roue chromatique clair", phone, "/notes", false, openWheel);
await audit("roue chromatique sombre", phone, "/notes", true, openWheel);
await audit("roue chromatique desktop", desktop, "/notes", false, openWheel);

await browser.close();
console.log(problems.length ? problems.join("\n") : "Aucun problème de contraste, de cible tactile ni de position.");
process.exit(problems.length ? 1 : 0);
