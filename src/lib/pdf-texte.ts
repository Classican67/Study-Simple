import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { degrees, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

import { parseMarkup, arbreListe, type Inline, type NoeudListe } from "@/components/rich-text";
import { centreTexte, MISE_EN_PAGE_TEXTE, type ZoneTexte } from "@/lib/notes";
import { couleurTexte, ENCRE_TEXTE } from "@/lib/pdf-texte-couleurs";

/**
 * Du texte sur une page de PDF, symboles mathématiques compris.
 *
 * Les polices standard d'un PDF s'arrêtent à l'alphabet latin : ni λ, ni ∑, ni ≤. Une
 * note qui en contient faisait tomber `drawText` en erreur. On embarque donc DejaVu,
 * dont les quatre graisses couvrent toute la palette de symboles — vérifié caractère
 * par caractère dans `tests/pdf-texte.test.ts` — et seules les lettres employées
 * entrent dans le fichier.
 *
 * La mise en page suit `MISE_EN_PAGE_TEXTE`, la même que l'écran : une zone doit sortir
 * du papier à la place et à la taille où on l'a posée.
 */

const POLICES = {
  // La coupe étroite : sa chasse est celle du texte à l'écran, à quelques pour cent
  // près. La large revenait à la ligne bien avant lui, et la zone sortait plus haute.
  normal: "DejaVuSansCondensed.ttf",
  gras: "DejaVuSansCondensed-Bold.ttf",
  italique: "DejaVuSansCondensed-Oblique.ttf",
  grasItalique: "DejaVuSansCondensed-BoldOblique.ttf",
} as const;
type Graisse = keyof typeof POLICES;

const dossier = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "node_modules/dejavu-fonts-ttf/ttf",
);

/** Les polices d'un document, chargées à la première zone : la plupart n'en ont pas. */
export function policesDuDocument(doc: PDFDocument) {
  const faces = new Map<Graisse, PDFFont>();
  let inscrit = false;
  return async (graisse: Graisse): Promise<PDFFont> => {
    const connue = faces.get(graisse);
    if (connue) return connue;
    if (!inscrit) {
      doc.registerFontkit(fontkit);
      inscrit = true;
    }
    const octets = await readFile(path.join(/* turbopackIgnore: true */ dossier, POLICES[graisse]));
    const face = await doc.embedFont(octets, { subset: true });
    faces.set(graisse, face);
    return face;
  };
}

type Mise = { gras: boolean; italique: boolean; barre: boolean; couleur: [number, number, number] };
type Mot = { texte: string; mise: Mise; espace: boolean };

const NEUTRE: Mise = { gras: false, italique: false, barre: false, couleur: ENCRE_TEXTE };

function aplatir(noeuds: Inline[], mise: Mise, sortie: { texte: string; mise: Mise }[]) {
  for (const noeud of noeuds) {
    switch (noeud.kind) {
      case "text":
        sortie.push({ texte: noeud.value, mise });
        break;
      case "strong":
        aplatir(noeud.children, { ...mise, gras: true }, sortie);
        break;
      case "em":
        aplatir(noeud.children, { ...mise, italique: true }, sortie);
        break;
      case "del":
        aplatir(noeud.children, { ...mise, barre: true }, sortie);
        break;
      case "code":
        aplatir(noeud.children, mise, sortie);
        break;
      case "color":
        aplatir(noeud.children, { ...mise, couleur: couleurTexte(noeud.color) }, sortie);
        break;
    }
  }
}

/** Découpe en mots, chacun avec sa mise en forme — un mot peut en changer en son milieu. */
function mots(noeuds: Inline[], depart: Mise): Mot[] {
  const morceaux: { texte: string; mise: Mise }[] = [];
  aplatir(noeuds, depart, morceaux);
  const sortie: Mot[] = [];
  for (const { texte, mise } of morceaux) {
    for (const trouve of texte.matchAll(/\S+|\s+/g)) {
      if (/^\s/.test(trouve[0])) {
        const dernier = sortie.at(-1);
        if (dernier) dernier.espace = true;
      } else {
        sortie.push({ texte: trouve[0], mise, espace: false });
      }
    }
  }
  return sortie;
}

type Ligne = { mots: Mot[]; corps: number; retrait: number; puce: string | null; apres: number };

async function lignesDe(
  zone: ZoneTexte,
  corps: number,
  largeur: number,
  police: (g: Graisse) => Promise<PDFFont>,
): Promise<Ligne[]> {
  const { entreBlocs, retrait: pasRetrait, titres } = MISE_EN_PAGE_TEXTE;
  const lignes: Ligne[] = [];

  const couper = async (
    contenu: Mot[],
    taille: number,
    retrait: number,
    puce: string | null,
    apres: number,
  ) => {
    const place = largeur - retrait;
    let ligne: Mot[] = [];
    let occupe = 0;
    let premiere = true;
    const fermer = (fin: boolean) => {
      lignes.push({ mots: ligne, corps: taille, retrait, puce: premiere ? puce : null, apres: fin ? apres : 0 });
      premiere = false;
      ligne = [];
      occupe = 0;
    };
    for (const mot of contenu) {
      const face = await police(graisseDe(mot.mise));
      const l = face.widthOfTextAtSize(lisible(face, mot.texte), taille);
      const blanc = ligne.length > 0 && ligne.at(-1)!.espace ? face.widthOfTextAtSize(" ", taille) : 0;
      if (ligne.length > 0 && occupe + blanc + l > place) fermer(false);
      occupe += (ligne.length > 0 ? blanc : 0) + l;
      ligne.push(mot);
    }
    fermer(true);
  };

  const liste = async (noeud: NoeudListe, niveau: number, depart: number) => {
    let numero = 0;
    for (const item of noeud.items) {
      numero += 1;
      const puce = noeud.ordonnee ? `${numero}.` : niveau === 0 ? "•" : niveau === 1 ? "◦" : "▪";
      await couper(mots(item.contenu, NEUTRE), corps, (niveau + 1) * pasRetrait * corps, puce, 0);
      for (const enfant of item.enfants) await liste(enfant, niveau + 1, 0);
    }
    if (depart > 0) lignes[lignes.length - 1].apres = depart;
  };

  for (const bloc of parseMarkup(zone.markup)) {
    const apres = entreBlocs * corps;
    if (bloc.kind === "heading") {
      const taille = corps * titres[bloc.level - 1];
      await couper(mots(bloc.children, { ...NEUTRE, gras: true }), taille, 0, null, apres);
    } else if (bloc.kind === "bullets" || bloc.kind === "numbers") {
      await liste(arbreListe(bloc), 0, apres);
    } else {
      for (const [i, ligne] of bloc.lines.entries()) {
        await couper(mots(ligne, NEUTRE), corps, 0, null, i === bloc.lines.length - 1 ? apres : 0);
      }
    }
  }
  return lignes;
}

function graisseDe(mise: Mise): Graisse {
  if (mise.gras && mise.italique) return "grasItalique";
  if (mise.gras) return "gras";
  return mise.italique ? "italique" : "normal";
}

/**
 * Remplace ce que la police n'a pas.
 *
 * Un caractère hors de DejaVu — un émoji collé — ferait échouer l'export entier pour
 * un seul signe : on perd le signe, pas le document.
 */
function lisible(face: PDFFont, texte: string): string {
  const jeu = face.getCharacterSet();
  return [...texte].map((c) => (jeu.includes(c.codePointAt(0)!) ? c : "?")).join("");
}

/** Pose une zone de texte sur une feuille. `page.getWidth()` vaut la largeur de la page. */
export async function poserTexte(
  feuille: PDFPage,
  zone: ZoneTexte,
  police: (g: Graisse) => Promise<PDFFont>,
) {
  const unite = feuille.getWidth();
  const hauteurFeuille = feuille.getHeight();
  const corps = zone.taille * unite;
  const largeur = zone.w * unite;
  const lignes = await lignesDe(zone, corps, largeur, police);

  const centre = centreTexte(zone);
  const angle = -zone.angle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  /** D'un point de la zone, en points depuis son coin haut-gauche, à la feuille. */
  const place = (x: number, y: number) => {
    const dx = zone.x * unite + x - centre.x * unite;
    const dy = -(zone.y * unite + y - centre.y * unite);
    return {
      x: centre.x * unite + dx * cos - dy * sin,
      y: hauteurFeuille - centre.y * unite + dx * sin + dy * cos,
    };
  };
  const rotate = degrees((angle * 180) / Math.PI);

  let y = 0;
  for (const ligne of lignes) {
    const pas = ligne.corps * MISE_EN_PAGE_TEXTE.interligne;
    // La ligne de base : le milieu de l'interligne, comme le fait le navigateur.
    const base = y + pas * 0.5 + ligne.corps * 0.34;
    if (ligne.puce) {
      const face = await police("normal");
      const l = face.widthOfTextAtSize(lisible(face, ligne.puce), ligne.corps);
      feuille.drawText(lisible(face, ligne.puce), {
        ...place(ligne.retrait - l - ligne.corps * 0.3, base),
        size: ligne.corps,
        font: face,
        color: rgb(...ENCRE_TEXTE),
        rotate,
      });
    }
    let x = ligne.retrait;
    for (const mot of ligne.mots) {
      const face = await police(graisseDe(mot.mise));
      const texte = lisible(face, mot.texte);
      const l = face.widthOfTextAtSize(texte, ligne.corps);
      feuille.drawText(texte, {
        ...place(x, base),
        size: ligne.corps,
        font: face,
        color: rgb(...mot.mise.couleur),
        rotate,
      });
      if (mot.mise.barre) {
        feuille.drawLine({
          start: place(x, base - ligne.corps * 0.3),
          end: place(x + l, base - ligne.corps * 0.3),
          thickness: ligne.corps * 0.06,
          color: rgb(...mot.mise.couleur),
        });
      }
      x += l + (mot.espace ? face.widthOfTextAtSize(" ", ligne.corps) : 0);
    }
    y += pas + ligne.apres;
  }
}
