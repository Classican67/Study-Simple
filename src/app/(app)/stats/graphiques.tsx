"use client";

import * as React from "react";

import type { CaseGrille, JourPrevu } from "@/lib/statistiques";
import { cn } from "@/lib/utils";

/**
 * Les deux graphiques du bilan.
 *
 * Une seule teinte, celle de l'app, de la plus claire à la plus foncée : c'est de
 * la quantité, pas de l'identité. Les paliers sont des rôles de thème mélangés à
 * la surface — ils se choisissent donc pour chaque thème au lieu de s'inverser.
 * Chaque case et chaque barre répond au survol comme au toucher, et un tableau
 * accompagne chaque graphique pour qui ne les voit pas.
 */

const PALIERS = [
  "bg-surface-high",
  "bg-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-surface-high))]",
  "bg-[color-mix(in_oklab,var(--color-primary)_52%,var(--color-surface-high))]",
  "bg-[color-mix(in_oklab,var(--color-primary)_76%,var(--color-surface-high))]",
  "bg-primary",
];

const JOURS = ["Lun", "", "Mer", "", "Ven", "", ""];

function dateLongue(jour: string): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, j, 12)));
}

function moisCourt(jour: string): string {
  const [a, m] = jour.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(a, m - 1, 15)))
    .replace(".", "");
}

/** La bulle du survol, posée au-dessus de la marque visée et gardée dans son cadre. */
function useBulle() {
  const cadre = React.useRef<HTMLDivElement>(null);
  const [bulle, setBulle] = React.useState<{ x: number; y: number; texte: string } | null>(null);
  const montrer = React.useCallback((element: HTMLElement, texte: string) => {
    const zone = cadre.current?.getBoundingClientRect();
    const marque = element.getBoundingClientRect();
    if (!zone) return;
    setBulle({ x: marque.left + marque.width / 2 - zone.left, y: marque.top - zone.top, texte });
  }, []);
  return { cadre, bulle, montrer, cacher: React.useCallback(() => setBulle(null), []) };
}

function Bulle({ bulle, largeur }: { bulle: { x: number; y: number; texte: string } | null; largeur: number }) {
  if (!bulle) return null;
  // Gardée dans le cadre : au bord, centrée sur la marque, elle sortirait.
  const moitie = 104;
  const x = Math.max(moitie, Math.min(Math.max(moitie, largeur - moitie), bulle.x));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full rounded-lg bg-surface-highest px-3 py-2 text-center m3-body-small text-on-surface elevation-2"
      style={{ left: x, top: bulle.y - 6 }}
    >
      {bulle.texte}
    </div>
  );
}

export function CarteActivite({ colonnes }: { colonnes: CaseGrille[][] }) {
  const { cadre, bulle, montrer, cacher } = useBulle();
  const [largeur, setLargeur] = React.useState(0);
  const defilement = React.useRef<HTMLDivElement>(null);

  // Sur téléphone, ce sont les dernières semaines qu'on veut voir d'abord.
  React.useEffect(() => {
    const el = defilement.current;
    if (el) el.scrollLeft = el.scrollWidth;
    const observer = new ResizeObserver(() => setLargeur(cadre.current?.clientWidth ?? 0));
    if (cadre.current) observer.observe(cadre.current);
    return () => observer.disconnect();
  }, [cadre]);

  const reperes = colonnes.map((colonne, i) => {
    const premier = colonne[0].jour;
    const nouveau = i === 0 || premier.slice(5, 7) !== colonnes[i - 1][0].jour.slice(5, 7);
    return nouveau ? moisCourt(premier) : null;
  });

  const texte = (c: CaseGrille) =>
    c.reponses === 0
      ? `${dateLongue(c.jour)} : pas de révision`
      : `${dateLongue(c.jour)} : ${c.reponses} réponse${c.reponses > 1 ? "s" : ""}, ${c.reussies} juste${c.reussies > 1 ? "s" : ""}`;

  const actifs = colonnes.flat().filter((c) => c.reponses > 0);

  return (
    <div ref={cadre} className="relative">
      <div ref={defilement} className="scroll-slim overflow-x-auto pb-1 pt-1">
        <div aria-hidden className="inline-grid min-w-full grid-flow-col gap-[3px]" style={{ gridTemplateColumns: `2rem repeat(${colonnes.length}, minmax(14px, 1fr))` }}>
          <div className="grid grid-rows-[1.25rem_repeat(7,1fr)] gap-[3px]">
            <span />
            {JOURS.map((jour, i) => (
              <span key={i} className="flex items-center m3-label-small text-on-surface-variant">
                {jour}
              </span>
            ))}
          </div>
          {colonnes.map((colonne, i) => (
            <div key={colonne[0].jour} className="grid grid-rows-[1.25rem_repeat(7,1fr)] gap-[3px]">
              <span className="overflow-visible whitespace-nowrap m3-label-small text-on-surface-variant">
                {reperes[i]}
              </span>
              {colonne.map((c) => (
                <button
                  key={c.jour}
                  type="button"
                  tabIndex={-1}
                  disabled={c.futur}
                  data-niveau={c.niveau}
                  onMouseEnter={(event) => montrer(event.currentTarget, texte(c))}
                  onMouseLeave={cacher}
                  onClick={(event) => montrer(event.currentTarget, texte(c))}
                  className={cn(
                    "aspect-square min-h-3.5 rounded-[3px]",
                    c.futur ? "invisible" : PALIERS[c.niveau],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <Bulle bulle={bulle} largeur={largeur} />

      <div aria-hidden className="mt-2 flex items-center justify-end gap-1 m3-label-small text-on-surface-variant">
        Moins
        {PALIERS.map((palier) => (
          <span key={palier} className={cn("size-3.5 rounded-[3px]", palier)} />
        ))}
        Plus
      </div>

      <table className="sr-only">
        <caption>Réponses par jour</caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Réponses</th>
            <th scope="col">Justes</th>
          </tr>
        </thead>
        <tbody>
          {actifs.map((c) => (
            <tr key={c.jour}>
              <th scope="row">{dateLongue(c.jour)}</th>
              <td>{c.reponses}</td>
              <td>{c.reussies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrevisionEcheances({ jours }: { jours: JourPrevu[] }) {
  const { cadre, bulle, montrer, cacher } = useBulle();
  const [largeur, setLargeur] = React.useState(0);
  React.useEffect(() => {
    const observer = new ResizeObserver(() => setLargeur(cadre.current?.clientWidth ?? 0));
    if (cadre.current) observer.observe(cadre.current);
    return () => observer.disconnect();
  }, [cadre]);

  const max = Math.max(1, ...jours.map((j) => j.cartes));
  const texte = (j: JourPrevu, i: number) =>
    `${i === 0 ? "Aujourd'hui" : dateLongue(j.jour)} : ${j.cartes} carte${j.cartes > 1 ? "s" : ""}`;

  return (
    <div ref={cadre} className="relative">
      <div aria-hidden className="flex h-36 items-stretch gap-0.5 border-b border-outline-variant">
        {jours.map((j, i) => (
          <button
            key={j.jour}
            type="button"
            tabIndex={-1}
            data-prevision={j.cartes}
            onMouseEnter={(event) => montrer(event.currentTarget.firstElementChild as HTMLElement, texte(j, i))}
            onMouseLeave={cacher}
            onClick={(event) => montrer(event.currentTarget.firstElementChild as HTMLElement, texte(j, i))}
            // La colonne entière réagit : une barre basse ne se viserait pas.
            className="flex min-w-0 flex-1 flex-col items-center justify-end"
          >
            <span
              className="block w-full max-w-7 rounded-t-[4px] bg-primary"
              style={{ height: j.cartes > 0 ? `${Math.max(3, (j.cartes / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between m3-label-small text-on-surface-variant">
        <span>Aujourd&apos;hui</span>
        <span>+{jours.length - 1} j</span>
      </div>
      <Bulle bulle={bulle} largeur={largeur} />
      <table className="sr-only">
        <caption>Cartes à revoir par jour</caption>
        <tbody>
          {jours.map((j, i) => (
            <tr key={j.jour}>
              <th scope="row">{i === 0 ? "Aujourd'hui" : dateLongue(j.jour)}</th>
              <td>{j.cartes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
