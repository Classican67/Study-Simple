"use client";

import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { hexToHsv, hsvToHex, parseHex } from "@/lib/ink-color";
import { cn } from "@/lib/utils";

/**
 * Roue chromatique : une couleur d'encre au-delà des six encres nommées.
 *
 * Un anneau pour la teinte, un carré pour la saturation et la luminosité — la
 * disposition des applications de dessin, qu'on règle au doigt comme au stylet.
 * Un code hexadécimal pour retrouver une couleur exacte, et les dernières
 * couleurs choisies pour ne pas avoir à la retrouver du tout.
 *
 * Le composant n'est monté qu'ouvert : son état part donc de la couleur
 * courante à chaque ouverture, sans effet pour le recaler.
 */

/** Épaisseur de l'anneau des teintes, en pixels : assez pour le pouce. */
const ANNEAU = 32;
/** Écart entre l'anneau et le carré. */
const JEU = 8;

const RECENTES_CLE = "fiches.encres-libres";
const RECENTES_MAX = 8;

const ARC_EN_CIEL =
  "conic-gradient(hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))";

/*
 * Les couleurs récentes vivent dans le navigateur.
 *
 * C'est une commodité propre à l'appareil, pas une donnée de la note : la
 * perdre (navigation privée, stockage refusé) ne coûte qu'un réglage à refaire.
 */
function lireRecentes(): string[] {
  try {
    const brut: unknown = JSON.parse(window.localStorage.getItem(RECENTES_CLE) ?? "[]");
    if (!Array.isArray(brut)) return [];
    return brut
      .map((c) => (typeof c === "string" ? parseHex(c) : null))
      .filter((c): c is string => c !== null)
      .slice(0, RECENTES_MAX);
  } catch {
    return [];
  }
}

function retenirRecente(hex: string) {
  try {
    const liste = [hex, ...lireRecentes().filter((c) => c !== hex)].slice(0, RECENTES_MAX);
    window.localStorage.setItem(RECENTES_CLE, JSON.stringify(liste));
  } catch {
    // Stockage refusé : la couleur sert quand même, elle n'est simplement pas retenue.
  }
}

/**
 * N'importe quelle couleur CSS → `#rrggbb`, en la peignant sur un pixel.
 *
 * Chromium rend les couleurs calculées en `oklch()` : les lire comme du RVB donne
 * n'importe quoi (cf. AGENTS.md). Le canevas, lui, fait la conversion juste.
 */
function cssVersHex(css: string): string | null {
  if (!css) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

/** Point de départ de la roue : la couleur libre courante, ou la teinte de l'encre nommée. */
function depart(value: string) {
  const hex =
    parseHex(value) ??
    cssVersHex(getComputedStyle(document.documentElement).getPropertyValue(`--ink-${value}`).trim()) ??
    "#1d5fbf";
  return hexToHsv(hex) ?? { h: 215, s: 0.85, v: 0.75 };
}

const borne = (x: number) => Math.max(0, Math.min(1, x));

export function InkWheel({
  onClose,
  value,
  highlighter = false,
  onPick,
}: {
  onClose: () => void;
  /** Couleur courante : un nom d'encre ou `#rrggbb`. */
  value: string;
  /** L'aperçu garde alors la transparence du surligneur. */
  highlighter?: boolean;
  onPick: (hex: string) => void;
}) {
  const [hsv, setHsv] = React.useState(() => depart(value));
  // Ce qui est tapé dans le champ, tant qu'on le tape : `null` quand le champ
  // suit simplement la roue.
  const [saisie, setSaisie] = React.useState<string | null>(null);
  const [recentes] = React.useState(lireRecentes);
  const zone = React.useRef<HTMLDivElement>(null);
  const prise = React.useRef<"teinte" | "intensite" | null>(null);
  const champ = React.useId();

  const roue = hsvToHex(hsv.h, hsv.s, hsv.v);
  // Un code tapé est pris tel quel : repasser par la roue pourrait l'arrondir
  // d'une unité, et « #d9480f » doit rester « #d9480f ».
  const choisie = (saisie !== null && parseHex(saisie)) || roue;

  /** Géométrie de la zone, mesurée au geste : elle suit la largeur de la feuille. */
  function mesure(event: React.PointerEvent) {
    const rect = zone.current!.getBoundingClientRect();
    const rayon = rect.width / 2;
    return {
      dx: event.clientX - (rect.left + rayon),
      dy: event.clientY - (rect.top + rayon),
      rayon,
      cote: Math.SQRT2 * (rayon - ANNEAU - JEU),
    };
  }

  function appliquer(event: React.PointerEvent) {
    const { dx, dy, cote } = mesure(event);
    setSaisie(null);
    if (prise.current === "teinte") {
      // Angle compté depuis le haut, dans le sens des aiguilles d'une montre :
      // c'est le sens du dégradé conique.
      const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      setHsv((p) => ({ ...p, h }));
    } else if (prise.current === "intensite") {
      setHsv((p) => ({ ...p, s: borne((dx + cote / 2) / cote), v: borne(1 - (dy + cote / 2) / cote) }));
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const { dx, dy, rayon, cote } = mesure(event);
    const distance = Math.hypot(dx, dy);
    if (distance >= rayon - ANNEAU - JEU / 2 && distance <= rayon + JEU) prise.current = "teinte";
    else if (Math.abs(dx) <= cote / 2 + JEU && Math.abs(dy) <= cote / 2 + JEU) prise.current = "intensite";
    else return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur déjà relâché : le geste s'arrête là, sans rien casser.
    }
    appliquer(event);
  }

  function clavierTeinte(event: React.KeyboardEvent) {
    const pas = event.shiftKey ? 15 : 5;
    const sens = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!sens) return;
    event.preventDefault();
    setSaisie(null);
    setHsv((p) => ({ ...p, h: (p.h + sens * pas + 360) % 360 }));
  }

  function clavierIntensite(event: React.KeyboardEvent) {
    const pas = event.shiftKey ? 0.1 : 0.02;
    const [ds, dv] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
      event.key
    ] ?? [0, 0];
    if (!ds && !dv) return;
    event.preventDefault();
    setSaisie(null);
    setHsv((p) => ({ ...p, s: borne(p.s + ds * pas), v: borne(p.v + dv * pas) }));
  }

  const radians = (hsv.h * Math.PI) / 180;
  const masque = `radial-gradient(farthest-side, transparent calc(100% - ${ANNEAU}px), #000 calc(100% - ${ANNEAU - 1}px))`;
  const pureTeinte = `hsl(${Math.round(hsv.h)} 100% 50%)`;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title="Choisir une couleur"
        description="Tourne l'anneau pour la teinte, puis règle l'intensité dans le carré."
        className="sm:max-w-md"
      >
        <div
          ref={zone}
          onPointerDown={onPointerDown}
          onPointerMove={(event) => {
            if (prise.current && event.buttons > 0) appliquer(event);
          }}
          onPointerUp={() => (prise.current = null)}
          onPointerCancel={() => (prise.current = null)}
          // La feuille défile : sans cela, régler la teinte au doigt la ferait
          // défiler en même temps.
          style={{ touchAction: "none" }}
          className="relative mx-auto aspect-square w-full max-w-72 select-none"
        >
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ background: ARC_EN_CIEL, WebkitMask: masque, mask: masque }}
          />

          {/* Pas d'`aria-hidden` ici, bien que le dégradé soit décoratif : la
              poignée de saturation vit dedans, et elle disparaissait avec lui
              de l'arbre d'accessibilité — introuvable au lecteur d'écran. */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg"
            style={{
              width: `calc(${Math.SQRT2} * (50% - ${ANNEAU + JEU}px))`,
              height: `calc(${Math.SQRT2} * (50% - ${ANNEAU + JEU}px))`,
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureTeinte})`,
            }}
          >
            <Poignee
              label="Saturation et luminosité"
              valeur={Math.round(hsv.v * 100)}
              texte={`Saturation ${Math.round(hsv.s * 100)} %, luminosité ${Math.round(hsv.v * 100)} %`}
              couleur={roue}
              onKeyDown={clavierIntensite}
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          <Poignee
            label="Teinte"
            valeur={Math.round(hsv.h)}
            max={359}
            texte={`Teinte ${Math.round(hsv.h)} degrés`}
            couleur={pureTeinte}
            onKeyDown={clavierTeinte}
            style={{
              left: `calc(50% + ${Math.sin(radians).toFixed(4)} * (50% - ${ANNEAU / 2}px))`,
              top: `calc(50% - ${Math.cos(radians).toFixed(4)} * (50% - ${ANNEAU / 2}px))`,
            }}
          />
        </div>

        <div className="mt-5 flex items-center gap-3">
          {/* L'aperçu est posé sur du papier : c'est là que la couleur servira,
              pas sur le fond de la feuille de réglage. */}
          <div
            aria-hidden
            className="papier flex h-11 min-w-0 flex-1 items-center rounded-xl border border-outline-variant px-4"
          >
            <span
              data-testid="apercu-encre"
              className="block h-2 w-full rounded-full"
              style={{ backgroundColor: choisie, opacity: highlighter ? 0.45 : 1 }}
            />
          </div>
          <label htmlFor={champ} className="sr-only">
            Code couleur
          </label>
          <input
            id={champ}
            value={saisie ?? roue}
            onChange={(event) => {
              setSaisie(event.target.value);
              const lu = parseHex(event.target.value);
              const suivant = lu ? hexToHsv(lu) : null;
              if (suivant) setHsv(suivant);
            }}
            onBlur={() => {
              // Un code valide reste tel qu'on l'a tapé ; un code incomplet
              // revient à la couleur de la roue.
              if (saisie !== null && !parseHex(saisie)) setSaisie(null);
            }}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="h-11 w-28 rounded-xl border border-outline-variant bg-surface-container px-3 font-mono uppercase m3-body-medium text-on-surface outline-none focus-visible:border-primary"
          />
        </div>

        {recentes.length > 0 ? (
          <div className="mt-4">
            <p className="m3-label-medium text-on-surface-variant">Récentes</p>
            <div className="mt-1 flex flex-wrap gap-0.5">
              {recentes.map((couleur) => (
                <button
                  key={couleur}
                  type="button"
                  aria-label={`Couleur ${couleur}`}
                  aria-pressed={couleur === choisie}
                  onClick={() => {
                    const suivant = hexToHsv(couleur);
                    if (suivant) setHsv(suivant);
                    setSaisie(couleur);
                  }}
                  className="grid size-11 place-items-center rounded-full"
                >
                  <span
                    className={cn(
                      "block size-7 rounded-full ring-1 ring-outline-variant",
                      couleur === choisie && "ring-2 ring-primary ring-offset-2 ring-offset-surface-high",
                    )}
                    style={{ backgroundColor: couleur }}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => {
              retenirRecente(choisie);
              onPick(choisie);
            }}
            className="state-layer min-h-11 rounded-full bg-primary px-6 m3-label-large text-on-primary"
          >
            Utiliser cette couleur
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Poignée d'un réglage : 44 px de cible, un disque de 24 px à l'œil. */
function Poignee({
  label,
  valeur,
  max = 100,
  texte,
  couleur,
  onKeyDown,
  style,
}: {
  label: string;
  valeur: number;
  max?: number;
  texte: string;
  couleur: string;
  onKeyDown: (event: React.KeyboardEvent) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={valeur}
      aria-valuetext={texte}
      onKeyDown={onKeyDown}
      className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={style}
    >
      <span
        className="block size-6 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45),0_1px_4px_rgb(0_0_0/0.4)]"
        style={{ backgroundColor: couleur }}
      />
    </div>
  );
}
