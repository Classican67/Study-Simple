"use client";

import * as React from "react";

import { RichEditor } from "@/components/rich-editor";
import { RichText } from "@/components/rich-text";
import { MISE_EN_PAGE_TEXTE, type ZoneTexte } from "@/lib/notes";

/**
 * Le texte posé sur une page manuscrite.
 *
 * Du HTML, sous les tuiles d'encre : il reste net à tous les zooms, le navigateur le
 * met en page, et l'on peut écrire dessus au stylet. Le corps suit la largeur de la
 * page — tout y est en multiples de lui — pour que zoomer agrandisse le texte sans le
 * remettre en page.
 */

function boite(zone: ZoneTexte, pageW: number): React.CSSProperties {
  return {
    left: `${zone.x * pageW}px`,
    top: `${zone.y * pageW}px`,
    width: `${zone.w * pageW}px`,
    fontSize: `${zone.taille * pageW}px`,
    lineHeight: MISE_EN_PAGE_TEXTE.interligne,
    transform: zone.angle ? `rotate(${zone.angle}rad)` : undefined,
    color: "var(--ink-default)",
  };
}

export function ZoneRendue({
  zone,
  pageW,
  onMesure,
}: {
  zone: ZoneTexte;
  pageW: number;
  /** La hauteur vient du navigateur : elle se lit, elle ne se calcule pas. */
  onMesure?: (id: string, h: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pageW === 0 || !onMesure) return;
    const h = el.offsetHeight / pageW;
    if (Math.abs(h - zone.h) > 0.002) onMesure(zone.id, Math.round(h * 10000) / 10000);
  }, [zone.markup, zone.w, zone.taille, zone.h, zone.id, pageW, onMesure]);

  return (
    <div ref={ref} data-zone-texte={zone.id} className="absolute" style={boite(zone, pageW)}>
      <RichText relatif>{zone.markup}</RichText>
    </div>
  );
}

export function EditeurZone({
  zone,
  pageW,
  terminerRef,
  onFin,
  onLargeur,
}: {
  zone: ZoneTexte;
  pageW: number;
  /** Déposée ici : toucher la page ne retire pas le focus sur iPad, il faut pouvoir finir. */
  terminerRef: React.RefObject<(() => void) | null>;
  onFin: (markup: string, h: number) => void;
  onLargeur: (w: number) => void;
}) {
  const racine = React.useRef<HTMLDivElement>(null);
  const champ = React.useRef<HTMLDivElement>(null);
  const markup = React.useRef(zone.markup);
  const fini = React.useRef(false);

  const finir = React.useCallback(() => {
    if (fini.current) return;
    fini.current = true;
    const hauteur = champ.current?.querySelector<HTMLElement>("[role=textbox]")?.offsetHeight ?? 0;
    onFin(markup.current.trim(), hauteur / (pageW || 1));
  }, [onFin, pageW]);

  React.useLayoutEffect(() => {
    terminerRef.current = finir;
    return () => {
      terminerRef.current = null;
    };
  }, [finir, terminerRef]);

  // Dans le geste même : iPadOS n'ouvre le clavier que pour un focus donné pendant
  // le toucher. D'où un effet de mise en page, joué par `flushSync` côté appelant.
  React.useLayoutEffect(() => {
    const champTexte = champ.current?.querySelector<HTMLElement>("[role=textbox]");
    if (!champTexte) return;
    champTexte.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(champTexte);
    selection?.collapseToEnd();
  }, []);

  const geste = React.useRef<{ x: number; w: number } | null>(null);

  return (
    <div
      ref={racine}
      data-editeur-texte=""
      className="pointer-events-auto absolute z-20 outline-2 outline-offset-2 outline-primary/60"
      style={{ ...boite(zone, pageW), touchAction: "auto" }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) finir();
      }}
      onKeyDown={(event) => {
        // Échap dans la palette de symboles ne referme qu'elle.
        if (event.key === "Escape" && (event.target as HTMLElement).getAttribute("role") === "textbox") {
          event.stopPropagation();
          finir();
        }
      }}
    >
      <div ref={champ}>
        <RichEditor
          flottant
          value={zone.markup}
          onChange={(valeur) => {
            markup.current = valeur;
          }}
          ariaLabel="Zone de texte"
          placeholder="Écris ici…"
          minHeight={`${MISE_EN_PAGE_TEXTE.interligne}em`}
        />
      </div>
      {/* La largeur, sans toucher au corps : c'est le cadre du lasso qui agrandit. */}
      <div
        role="slider"
        tabIndex={-1}
        aria-label="Largeur de la zone de texte"
        aria-valuemin={3}
        aria-valuemax={100}
        aria-valuenow={Math.round(zone.w * 100)}
        data-largeur-texte=""
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          geste.current = { x: event.clientX, w: zone.w };
        }}
        onPointerMove={(event) => {
          if (!geste.current) return;
          onLargeur(Math.max(0.08, geste.current.w + (event.clientX - geste.current.x) / (pageW || 1)));
        }}
        onPointerUp={() => {
          geste.current = null;
        }}
        className="absolute -right-6 top-0 grid h-full min-h-11 w-11 cursor-ew-resize place-items-center"
        style={{ touchAction: "none" }}
      >
        <span aria-hidden className="h-8 w-1.5 rounded-full bg-primary elevation-1" />
      </div>
    </div>
  );
}

/**
 * Peint des zones sur un canevas : le presse-papiers et les cartes n'ont pas de HTML.
 *
 * Sans gras ni couleur : c'est une image de la zone, et ce qu'on veut y lire, c'est le
 * texte. L'unité du contexte est la largeur de page.
 */
export function peindreZones(
  contexte: CanvasRenderingContext2D,
  zones: ZoneTexte[],
  enTexte: (markup: string) => string,
  encre: string,
) {
  // Le navigateur arrondit les petits corps : on dessine à cent fois la taille.
  const f = 100;
  contexte.save();
  contexte.scale(1 / f, 1 / f);
  contexte.fillStyle = encre;
  contexte.textBaseline = "middle";
  for (const zone of zones) {
    const corps = zone.taille * f;
    const pas = corps * MISE_EN_PAGE_TEXTE.interligne;
    contexte.font = `${corps}px sans-serif`;
    let y = zone.y * f + pas / 2;
    for (const paragraphe of enTexte(zone.markup).split("\n")) {
      let ligne = "";
      for (const mot of paragraphe.split(/\s+/)) {
        const essai = ligne ? `${ligne} ${mot}` : mot;
        if (ligne && contexte.measureText(essai).width > zone.w * f) {
          contexte.fillText(ligne, zone.x * f, y);
          y += pas;
          ligne = mot;
        } else {
          ligne = essai;
        }
      }
      contexte.fillText(ligne, zone.x * f, y);
      y += pas;
    }
  }
  contexte.restore();
}
