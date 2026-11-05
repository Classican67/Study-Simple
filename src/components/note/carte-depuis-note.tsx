"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";

import { addCardFromNote, listDecksPourCarte } from "@/app/(app)/decks/[deckId]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toPlainText } from "@/components/rich-text";
import { peindreZones } from "@/components/note/zones-texte";
import type { Bounds } from "@/lib/ink";
import { alphaParPasse, INK_REF, instrumentOf } from "@/lib/ink";
import { resolveInk } from "@/lib/ink-color";
import { pathsOf } from "@/lib/ink-paths";
import { PAPER_COLORS, type DrawingContent } from "@/lib/notes";

/**
 * Faire une carte de ce qu'on vient d'entourer.
 *
 * Les notes sont là pour nourrir les cartes, et il n'y avait aucun pont entre les
 * deux : on recopiait à la main. La zone devient l'image de la réponse, et il ne
 * reste qu'à écrire la question.
 */

const COTE_MAX = 1600;
const MARGE = 0.01;

/**
 * La zone telle qu'elle est à l'écran : papier, polycopié, images, encre.
 *
 * Le fond vient des éléments déjà rendus — pdf.js a fait le travail. L'encre est
 * retracée d'après les traits plutôt que recopiée des tuiles : une tuile n'existe
 * que près de ce qu'on regarde, et sa teinte dépend du thème.
 */
async function capturer(scrollId: string, content: DrawingContent, cadre: Bounds): Promise<Blob> {
  const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
  const page = surface?.firstElementChild as HTMLElement | null;
  if (!page) throw new Error("page introuvable");

  const boite = page.getBoundingClientRect();
  const x0 = Math.max(0, cadre.minX - MARGE);
  const y0 = Math.max(0, cadre.minY - MARGE);
  const l = Math.min(1, cadre.maxX + MARGE) - x0;
  const h = cadre.maxY + MARGE - y0;
  const echelle = Math.min(COTE_MAX / Math.max(l, h), COTE_MAX);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(l * echelle));
  canvas.height = Math.max(1, Math.round(h * echelle));
  const contexte = canvas.getContext("2d");
  if (!contexte) throw new Error("canevas indisponible");
  contexte.fillStyle = PAPER_COLORS.fond;
  contexte.fillRect(0, 0, canvas.width, canvas.height);

  const facteur = echelle / boite.width;
  for (const element of page.querySelectorAll<HTMLElement>("canvas, img")) {
    if (element.hasAttribute("data-ink-tile") || element.hasAttribute("data-ink-couche")) continue;
    const r = element.getBoundingClientRect();
    if (r.width === 0) continue;
    const gauche = (r.left - boite.left) * facteur - x0 * echelle;
    const haut = (r.top - boite.top) * facteur - y0 * echelle;
    const image = element as HTMLImageElement | HTMLCanvasElement;
    const angle = Number(element.dataset.angle) || 0;
    if (angle) {
      const largeur = element.offsetWidth * facteur;
      const hauteur = element.offsetHeight * facteur;
      contexte.save();
      contexte.translate(gauche + (r.width * facteur) / 2, haut + (r.height * facteur) / 2);
      contexte.rotate(angle);
      contexte.drawImage(image, -largeur / 2, -hauteur / 2, largeur, hauteur);
      contexte.restore();
    } else {
      contexte.drawImage(image, gauche, haut, r.width * facteur, r.height * facteur);
    }
  }

  const temoin = document.createElement("div");
  temoin.className = "ink-clair";
  temoin.hidden = true;
  document.body.appendChild(temoin);
  const styles = getComputedStyle(temoin);
  contexte.save();
  contexte.scale(echelle, echelle);
  contexte.translate(-x0, -y0);
  peindreZones(contexte, content.textes, toPlainText, resolveInk(styles, "default"));
  contexte.scale(1 / INK_REF, 1 / INK_REF);
  const ordonnes = [...content.strokes].sort(
    (a, b) => Number(instrumentOf(b.tool).dessous) - Number(instrumentOf(a.tool).dessous),
  );
  for (const stroke of ordonnes) {
    const chemins = pathsOf(stroke);
    if (chemins.length === 0) continue;
    contexte.globalAlpha = alphaParPasse(instrumentOf(stroke.tool).alpha, chemins.length);
    contexte.fillStyle = resolveInk(styles, stroke.color);
    for (const chemin of chemins) contexte.fill(chemin);
  }
  contexte.restore();
  temoin.remove();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("image vide"))), "image/jpeg", 0.9);
  });
}

export function CarteDepuisNote({
  scrollId,
  content,
  cadre,
  onClose,
}: {
  scrollId: string;
  content: DrawingContent;
  cadre: Bounds;
  onClose: () => void;
}) {
  const [paquets, setPaquets] = React.useState<{ id: string; title: string }[] | null>(null);
  const [paquet, setPaquet] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [reponse, setReponse] = React.useState("");
  const [image, setImage] = React.useState<{ blob: Blob; url: string } | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [faite, setFaite] = React.useState(false);

  React.useEffect(() => {
    let annule = false;
    let url = "";
    capturer(scrollId, content, cadre)
      .then((blob) => {
        if (annule) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      })
      .catch(() => setErreur("Cette zone n'a pas pu être capturée."));
    listDecksPourCarte()
      .then((liste) => {
        if (annule) return;
        setPaquets(liste);
        setPaquet(liste[0]?.id ?? "");
      })
      .catch(() => setErreur("Les paquets n'ont pas pu être lus. Vérifie ta connexion."));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Une fois, à l'ouverture : c'est la zone telle qu'on l'a entourée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function creer(event: React.FormEvent) {
    event.preventDefault();
    if (!image || !paquet) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const data = new FormData();
      data.set("term", question);
      data.set("definition", reponse);
      data.set("image", new File([image.blob], "note.jpg", { type: "image/jpeg" }));
      const resultat = await addCardFromNote(paquet, data);
      if (resultat.ok) {
        setFaite(true);
        window.setTimeout(onClose, 900);
      } else {
        setErreur(resultat.error);
      }
    } catch {
      setErreur("La carte n'a pas pu être créée. Vérifie ta connexion.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent
        title="Créer une carte"
        description="Ce que tu as entouré devient l'image de la réponse."
      >
        <form onSubmit={creer} className="space-y-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt="Zone entourée"
              data-carte-apercu=""
              className="max-h-48 w-full rounded-lg border border-outline-variant object-contain"
            />
          ) : (
            <div className="grid h-24 place-items-center text-on-surface-variant">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          <label className="block m3-label-large text-on-surface">
            Paquet
            <select
              value={paquet}
              onChange={(event) => setPaquet(event.target.value)}
              className="mt-1 h-12 w-full rounded-lg border border-outline-variant bg-surface-lowest px-3 m3-body-medium text-on-surface"
            >
              {(paquets ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          {paquets && paquets.length === 0 ? (
            <p className="m3-body-small text-on-surface-variant">Crée d&apos;abord un paquet pour y ranger des cartes.</p>
          ) : null}

          <label className="block m3-label-large text-on-surface">
            Question
            <input
              autoFocus
              required
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="mt-1 h-12 w-full rounded-lg border border-outline-variant bg-surface-lowest px-3 m3-body-medium text-on-surface"
            />
          </label>

          <label className="block m3-label-large text-on-surface">
            Réponse, en plus de l&apos;image (facultatif)
            <textarea
              value={reponse}
              onChange={(event) => setReponse(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-lowest p-3 m3-body-medium text-on-surface"
            />
          </label>

          {erreur ? (
            <p role="alert" className="m3-body-small text-error">
              {erreur}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="text" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={envoi || faite || !image || !paquet || !question.trim()}>
              {faite ? <Check /> : envoi ? <Loader2 className="animate-spin" /> : null}
              {faite ? "Carte créée" : "Créer la carte"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
