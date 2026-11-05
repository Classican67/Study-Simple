/**
 * Coller en gardant la structure.
 *
 * Ce qui arrive du presse-papiers est du HTML écrit pour un autre logiciel. Il
 * n'entre jamais tel quel : on en tire des **blocs** — du texte dans notre
 * balisage, des tableaux — et rien d'autre. Titres, listes imbriquées, gras,
 * italique et tableaux survivent ; polices, marges et classes restent dehors.
 *
 * Trois sources occupent presque tous les cas, et chacune a ses manies :
 *
 * - **Word** n'écrit pas de listes : des paragraphes `MsoListParagraph` portant
 *   leur niveau dans `mso-list`, et leur puce **en texte**, dans un élément à
 *   retirer sous peine de la voir doublée.
 * - **Google Docs** enveloppe tout dans un `<b style="font-weight:normal">` —
 *   tout le document semblerait gras — et met le vrai gras sur des `<span>`.
 * - **Le web** range son texte dans des `<div>` et des `<section>` imbriqués, et
 *   ses retours à la ligne de source ne veulent rien dire.
 *
 * Pure tant qu'on lui donne un `DOMParser` : c'est ce qui permet d'éprouver les
 * fragments réels de ces logiciels sans navigateur.
 */

import { escapeMarkup, type TextColor } from "@/components/rich-text";
import { serializeEditor } from "@/lib/balisage-dom";
import { MAX_CELL_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS } from "@/lib/notes";

export type BlocColle =
  | { kind: "text"; markup: string }
  | { kind: "table"; rows: string[][] };

/** Au-delà, le texte passe sur un bloc de plus : un bloc se manipule d'un geste. */
const TEXTE_PAR_BLOC = 16_000;

const A_RETIRER = "script, style, meta, link, title, head, noscript, iframe, object, embed, svg, canvas, img, video, audio, input, button, select, textarea, nav, form";

/** Balises à traiter comme un simple paragraphe. */
const BLOCS_GENERIQUES = new Set([
  "section", "article", "main", "header", "footer", "aside", "figure", "figcaption",
  "address", "details", "summary", "dd", "dt", "dl", "center", "hgroup",
]);

const BALISES_BLOC = new Set([
  ...BLOCS_GENERIQUES, "div", "p", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "table", "hr",
]);

/** Une couleur écrite en dur, ramenée à la plus proche de nos cinq — ou à rien. */
export function couleurProche(valeur: string): TextColor | null {
  const rgb = lireRgb(valeur);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const ecart = max - min;
  // Un gris n'est pas une couleur : le noir d'un corps de texte, surtout, ne doit
  // pas teinter tout ce qu'on colle. Trop clair, il serait illisible sur nos fonds.
  if (ecart < 48 || max < 60 || min > 200) return null;
  let teinte: number;
  if (max === r) teinte = (((g - b) / ecart) * 60 + 360) % 360;
  else if (max === g) teinte = ((b - r) / ecart) * 60 + 120;
  else teinte = ((r - g) / ecart) * 60 + 240;
  if (teinte < 20 || teinte >= 330) return "rose";
  if (teinte < 70) return "amber";
  if (teinte < 170) return "emerald";
  if (teinte < 255) return "blue";
  return "violet";
}

function lireRgb(valeur: string): [number, number, number] | null {
  const texte = valeur.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(texte);
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fonction = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(texte);
  if (fonction) return [Number(fonction[1]), Number(fonction[2]), Number(fonction[3])];
  const noms: Record<string, [number, number, number]> = {
    red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], purple: [128, 0, 128],
    orange: [255, 165, 0], navy: [0, 0, 128], teal: [0, 128, 128], maroon: [128, 0, 0],
  };
  return noms[texte] ?? null;
}

function balise(element: Element): string {
  return element.tagName.toLowerCase();
}

function remplacerBalise(element: Element, nom: string): HTMLElement {
  const nouveau = element.ownerDocument.createElement(nom);
  for (const attribut of Array.from(element.attributes)) {
    if (attribut.name === "style") nouveau.setAttribute("style", attribut.value);
  }
  while (element.firstChild) nouveau.appendChild(element.firstChild);
  element.replaceWith(nouveau);
  return nouveau;
}

function deballer(element: Element) {
  element.replaceWith(...Array.from(element.childNodes));
}

/**
 * Word : des paragraphes qui se prennent pour des listes.
 *
 * Il suffit de repérer `mso-list`, de lire le niveau, de jeter la puce écrite en
 * texte, puis de remettre tout cela dans de vraies listes imbriquées.
 */
function redresserListesWord(racine: HTMLElement) {
  const paragraphes = Array.from(racine.querySelectorAll<HTMLElement>("p"));
  let ouvertes: HTMLElement[] = [];
  let precedent: Element | null = null;

  for (const paragraphe of paragraphes) {
    const style = paragraphe.getAttribute("style") ?? "";
    const trouve = /mso-list:\s*\S+\s+level(\d+)/i.exec(style);
    if (!trouve) continue;

    const niveau = Math.max(1, Number(trouve[1]));
    // La puce est dans un élément marqué `mso-list:Ignore`, ou dans le premier
    // `<span>` quand Word a retiré ses commentaires conditionnels.
    const marqueur =
      Array.from(paragraphe.querySelectorAll<HTMLElement>("[style]")).find((e) =>
        /mso-list:\s*ignore/i.test(e.getAttribute("style") ?? ""),
      ) ?? null;
    const texteMarqueur = (marqueur?.textContent ?? "").trim();
    marqueur?.remove();
    const ordonnee = /^\(?[0-9a-z]{1,3}[.)]/i.test(texteMarqueur);

    if (paragraphe.previousElementSibling !== precedent) ouvertes = [];
    while (ouvertes.length > niveau) ouvertes.pop();
    const document = paragraphe.ownerDocument;
    while (ouvertes.length < niveau) {
      const liste = document.createElement(ordonnee ? "ol" : "ul");
      const parent = ouvertes.at(-1);
      if (parent) (parent.lastElementChild ?? parent).appendChild(liste);
      else paragraphe.before(liste);
      ouvertes.push(liste);
    }

    const element = document.createElement("li");
    while (paragraphe.firstChild) element.appendChild(paragraphe.firstChild);
    ouvertes[ouvertes.length - 1].appendChild(element);
    precedent = ouvertes[0];
    paragraphe.remove();
  }
}

/** Les espaces de la source HTML ne veulent rien dire ; ceux de `<pre>`, si. */
function normaliserEspaces(noeud: Node) {
  for (const enfant of Array.from(noeud.childNodes)) {
    if (enfant.nodeType === 3) {
      const valeur = (enfant.textContent ?? "").replace(/ /g, " ").replace(/[ \t\r\n\f]+/g, " ");
      const parent = enfant.parentElement;
      // Un blanc seul entre deux blocs n'est qu'une mise en page de la source.
      if (
        valeur === " " &&
        parent &&
        (BALISES_BLOC.has(balise(parent)) || parent === noeud) &&
        (!enfant.previousSibling || !enfant.nextSibling ||
          estBloc(enfant.previousSibling) || estBloc(enfant.nextSibling))
      ) {
        enfant.remove();
      } else {
        enfant.textContent = valeur;
      }
    } else if (enfant.nodeType === 1 && balise(enfant as Element) !== "pre") {
      normaliserEspaces(enfant);
    }
  }
}

function estBloc(noeud: Node): boolean {
  return noeud.nodeType === 1 && BALISES_BLOC.has(balise(noeud as Element));
}

/** `<pre>` : chaque ligne reste une ligne, en code. */
function redresserPre(racine: HTMLElement) {
  for (const pre of Array.from(racine.querySelectorAll("pre"))) {
    const document = pre.ownerDocument;
    const lignes = (pre.textContent ?? "").replace(/\n+$/, "").split("\n");
    const bloc = document.createElement("div");
    for (const ligne of lignes) {
      const conteneur = document.createElement("div");
      if (ligne.trim()) {
        const code = document.createElement("code");
        code.textContent = ligne;
        conteneur.appendChild(code);
      }
      bloc.appendChild(conteneur);
    }
    pre.replaceWith(bloc);
  }
}

/** Traduit les styles qui ont un sens pour nous, et laisse tomber les autres. */
function traduireStyles(racine: HTMLElement) {
  // L'enveloppe de Google Docs : sans cela, tout le document sortirait en gras.
  for (const gras of Array.from(racine.querySelectorAll("b, strong"))) {
    const poids = (gras as HTMLElement).style?.fontWeight;
    if (poids === "normal" || poids === "400") deballer(gras);
  }

  for (const element of Array.from(racine.querySelectorAll<HTMLElement>("[style], font[color]"))) {
    const couleur = element.getAttribute("color") ?? element.style?.color ?? "";
    const proche = couleur ? couleurProche(couleur) : null;
    const barre = /line-through/.test(element.style?.textDecoration ?? "") ||
      /line-through/.test(element.style?.textDecorationLine ?? "");
    let cible: HTMLElement = element;
    if (barre) {
      const del = element.ownerDocument.createElement("s");
      while (cible.firstChild) del.appendChild(cible.firstChild);
      cible.appendChild(del);
    }
    if (proche) {
      // Sur un `<span>` seulement : c'est là que la transcription lit `data-c`.
      if (balise(cible) !== "span") {
        const span = cible.ownerDocument.createElement("span");
        while (cible.firstChild) span.appendChild(cible.firstChild);
        cible.appendChild(span);
        cible = span;
      }
      cible.dataset.c = proche;
    }
  }
}

function celluleTexte(cellule: Element): string {
  return (cellule.textContent ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CELL_LENGTH);
}

/** Une table HTML en grille, cellules fusionnées déroulées. */
function lireTable(table: Element): string[][] {
  const lignes: string[][] = [];
  const debordes = new Map<number, number>();
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    if (tr.closest("table") !== table) continue;
    const ligne: string[] = [];
    let colonne = 0;
    const avancer = () => {
      while ((debordes.get(colonne) ?? 0) > 0) {
        debordes.set(colonne, debordes.get(colonne)! - 1);
        ligne[colonne] = "";
        colonne += 1;
      }
    };
    for (const cellule of Array.from(tr.children)) {
      const tag = balise(cellule);
      if (tag !== "td" && tag !== "th") continue;
      avancer();
      ligne[colonne] = celluleTexte(cellule);
      const etendue = Math.max(1, Number(cellule.getAttribute("colspan")) || 1);
      const hauteur = Math.max(1, Number(cellule.getAttribute("rowspan")) || 1);
      for (let i = 0; i < etendue; i++) {
        if (hauteur > 1) debordes.set(colonne + i, hauteur - 1);
        if (i > 0) ligne[colonne + i] = "";
      }
      colonne += etendue;
    }
    avancer();
    lignes.push(Array.from({ length: ligne.length }, (_, i) => ligne[i] ?? ""));
  }
  return grille(lignes);
}

/** Met une grille aux bornes d'un tableau de note, et à l'équerre. */
export function grille(lignes: string[][]): string[][] {
  const bornees = lignes.slice(0, MAX_TABLE_ROWS).map((ligne) => ligne.slice(0, MAX_TABLE_COLS));
  const largeur = Math.max(0, ...bornees.map((ligne) => ligne.length));
  return bornees
    .map((ligne) => [...ligne, ...Array<string>(largeur - ligne.length).fill("")])
    .filter((ligne) => ligne.some((cellule) => cellule !== ""));
}

/**
 * Un tableau d'une seule colonne ou d'une seule ligne n'en est pas un : c'est la
 * mise en page d'une page web. On garde alors son texte.
 */
function estVraiTableau(rows: string[][]): boolean {
  return rows.length >= 2 && (rows[0]?.length ?? 0) >= 2;
}

/** Découpe le corps en texte et tableaux, dans l'ordre du document. */
function decouper(racine: HTMLElement): BlocColle[] {
  const blocs: BlocColle[] = [];
  let tampon = racine.ownerDocument.createElement("div");

  const vider = () => {
    const markup = serializeEditor(tampon);
    if (markup) blocs.push({ kind: "text", markup });
    tampon = racine.ownerDocument.createElement("div");
  };

  const parcourir = (conteneur: Element) => {
    for (const enfant of Array.from(conteneur.childNodes)) {
      if (enfant.nodeType === 1) {
        const element = enfant as HTMLElement;
        const contientTable = balise(element) === "table" || element.querySelector("table");
        if (contientTable) {
          if (balise(element) === "table") {
            const rows = lireTable(element);
            if (estVraiTableau(rows)) {
              vider();
              blocs.push({ kind: "table", rows });
            } else {
              for (const cellule of Array.from(element.querySelectorAll("td, th"))) {
                const div = racine.ownerDocument.createElement("div");
                div.textContent = celluleTexte(cellule);
                tampon.appendChild(div);
              }
            }
          } else {
            parcourir(element);
          }
          continue;
        }
      }
      tampon.appendChild(enfant);
    }
  };

  parcourir(racine);
  vider();
  return blocs;
}

export function htmlVersBlocs(html: string, parser: DOMParser): BlocColle[] {
  // Les commentaires conditionnels de Word portent des balises entières.
  const propre = html.replace(/<!\[if[^\]]*\]>|<!\[endif\]>/gi, "");
  const racine = parser.parseFromString(propre, "text/html").body;
  if (!racine) return [];

  redresserListesWord(racine);
  redresserPre(racine);
  for (const element of Array.from(racine.querySelectorAll(A_RETIRER))) element.remove();
  traduireStyles(racine);

  for (const element of Array.from(racine.querySelectorAll("*"))) {
    const tag = balise(element);
    if (BLOCS_GENERIQUES.has(tag)) remplacerBalise(element, "div");
    else if (tag === "h5" || tag === "h6") remplacerBalise(element, "h4");
    else if (tag === "hr") element.remove();
    else if (tag === "a" || tag === "font" || tag === "mark" || tag === "u" || tag === "abbr") {
      deballer(element);
    } else if (tag === "blockquote") {
      // Notre balisage n'a pas de citation — et `> 65 ans` en début de ligne doit
      // rester du texte. Elle passe donc en italique, ligne par ligne.
      const em = element.ownerDocument.createElement("em");
      while (element.firstChild) em.appendChild(element.firstChild);
      element.replaceWith(em);
      const div = em.ownerDocument.createElement("div");
      em.replaceWith(div);
      div.appendChild(em);
    }
  }

  normaliserEspaces(racine);
  return repartir(decouper(racine));
}

const TITRE_MD = /^\s{0,3}(#{1,6})\s+(.*)$/;
const PUCE_TEXTE = /^(\s*)[-*•–—▪◦·]\s+(.*)$/;
const NUMERO_TEXTE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const LIGNE_TABLE_MD = /^\s*\|.*\|\s*$/;
const SEPARATEUR_MD = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;

/** Du Markdown collé garde son gras ; du texte ordinaire garde ses étoiles. */
function ligneTexte(texte: string, markdown: boolean): string {
  return markdown ? texte.replace(/\\/g, "\\\\") : escapeMarkup(texte);
}

function celluleMd(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cellule) => cellule.trim().slice(0, MAX_CELL_LENGTH));
}

/**
 * Du texte brut : une feuille de calcul, du Markdown, ou de simples lignes.
 *
 * Une feuille de calcul colle des tabulations ; Markdown, des barres verticales.
 * Tout le reste reste du texte, mais ses puces et ses titres écrits à la main
 * deviennent de vraies listes et de vrais titres.
 */
export function texteVersBlocs(texte: string): BlocColle[] {
  const source = texte.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!source.trim()) return [];

  const brutes = source.split("\n");
  if (brutes.length >= 2 && brutes.every((l) => l.includes("\t"))) {
    const rows = grille(brutes.map((l) => l.split("\t").map((c) => c.trim().slice(0, MAX_CELL_LENGTH))));
    if (rows.length > 0) return [{ kind: "table", rows }];
  }

  const markdown =
    /\*\*[^*\n]+\*\*|^\s{0,3}#{1,6}\s/m.test(source) || brutes.some((l) => SEPARATEUR_MD.test(l));

  const blocs: BlocColle[] = [];
  let lignes: string[] = [];
  const vider = () => {
    const markup = lignes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (markup) blocs.push({ kind: "text", markup });
    lignes = [];
  };

  for (let i = 0; i < brutes.length; i++) {
    const ligne = brutes[i];

    if (LIGNE_TABLE_MD.test(ligne) && SEPARATEUR_MD.test(brutes[i + 1] ?? "")) {
      const rows = [celluleMd(ligne)];
      i += 2;
      while (i < brutes.length && LIGNE_TABLE_MD.test(brutes[i])) rows.push(celluleMd(brutes[i++]));
      i -= 1;
      vider();
      blocs.push({ kind: "table", rows: grille(rows) });
      continue;
    }

    const titre = markdown ? TITRE_MD.exec(ligne) : null;
    if (titre) {
      lignes.push(`${"#".repeat(Math.min(3, titre[1].length))} ${ligneTexte(titre[2].trim(), true)}`);
      continue;
    }
    const puce = PUCE_TEXTE.exec(ligne);
    if (puce) {
      lignes.push(`${retrait(puce[1])}- ${ligneTexte(puce[2], markdown)}`);
      continue;
    }
    const numero = NUMERO_TEXTE.exec(ligne);
    if (numero) {
      lignes.push(`${retrait(numero[1])}${numero[2]}. ${ligneTexte(numero[3], markdown)}`);
      continue;
    }
    lignes.push(ligneTexte(ligne, markdown));
  }
  vider();
  return repartir(blocs);
}

/** Un niveau tous les deux espaces, qu'on en ait tapé deux, quatre ou une tabulation. */
function retrait(espaces: string): string {
  const largeur = espaces.replace(/\t/g, "    ").length;
  return "  ".repeat(Math.ceil(largeur / 4) || (largeur >= 2 ? 1 : 0));
}

/**
 * Répartit un très long texte sur plusieurs blocs, entre deux lignes.
 *
 * Un chapitre entier dans un seul champ se manipule mal, et chaque frappe
 * retranscrirait le tout.
 */
function repartir(blocs: BlocColle[]): BlocColle[] {
  const sortie: BlocColle[] = [];
  for (const bloc of blocs) {
    if (bloc.kind !== "text" || bloc.markup.length <= TEXTE_PAR_BLOC) {
      sortie.push(bloc);
      continue;
    }
    let tampon = "";
    for (const ligne of bloc.markup.split("\n")) {
      if (tampon && tampon.length + ligne.length + 1 > TEXTE_PAR_BLOC) {
        sortie.push({ kind: "text", markup: tampon });
        tampon = "";
      }
      tampon = tampon ? `${tampon}\n${ligne}` : ligne;
    }
    if (tampon) sortie.push({ kind: "text", markup: tampon });
  }
  return sortie;
}

/** Ce qu'un collage apporte, depuis le presse-papiers tel qu'il est. */
export function blocsDuPressePapiers(
  html: string,
  texte: string,
  parser: DOMParser = new DOMParser(),
): BlocColle[] {
  if (html.trim()) {
    const blocs = htmlVersBlocs(html, parser);
    if (blocs.length > 0) return blocs;
  }
  return texteVersBlocs(texte);
}

/** La grille d'un collage, pour le remplissage d'un tableau déjà là. */
export function grilleDuPressePapiers(
  html: string,
  texte: string,
  parser: DOMParser = new DOMParser(),
): string[][] | null {
  if (/<table/i.test(html)) {
    const table = parser.parseFromString(html, "text/html").querySelector("table");
    if (table) {
      const rows = lireTable(table);
      if (rows.length > 0) return rows;
    }
  }
  const lignes = texte.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lignes.length < 2 && !lignes[0]?.includes("\t")) return null;
  return grille(lignes.map((l) => l.split("\t").map((c) => c.trim().slice(0, MAX_CELL_LENGTH))));
}

/** Un tableau redit en lignes, pour une carte qui n'a pas de tableaux. */
export function tableEnLignes(rows: string[][]): string {
  return rows.map((row) => `- ${escapeMarkup(row.filter(Boolean).join(" — "))}`).join("\n");
}

/** Le contenu d'un bloc tel que l'enregistre la note. */
export function contenuDuBloc(bloc: BlocColle): { kind: "text" | "table"; content: string } {
  return bloc.kind === "text"
    ? { kind: "text", content: JSON.stringify({ style: "p", markup: bloc.markup }) }
    : { kind: "table", content: JSON.stringify({ rows: bloc.rows }) };
}
