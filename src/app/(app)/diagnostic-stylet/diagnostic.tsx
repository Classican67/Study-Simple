"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

/**
 * Ce que le navigateur livre vraiment quand on écrit.
 *
 * Un défaut de tracé ne se reproduit pas sur un navigateur de bureau : Safari a
 * ses propres horodatages, ses arrondis et ses événements fusionnés incomplets. Cet
 * écran ne passe par aucun filtre : il dessine et compte ce qui arrive, pour qu'on
 * règle le tracé sur des mesures de l'appareil plutôt que sur des hypothèses.
 */

type Lot = {
  t: number;
  x: number;
  y: number;
  p: number;
  type: string;
  n: number;
  fusionnes: { t: number; x: number; y: number; p: number; type: string }[];
  predits: number;
};

const LOTS_MAX = 4000;

function pourcent(a: number, b: number) {
  return b === 0 ? "—" : `${Math.round((a / b) * 100)} %`;
}

function analyser(lots: Lot[], annulations: number, poses: number) {
  const fusionnes = lots.flatMap((l) => l.fusionnes);
  const positions = [...lots.map((l) => [l.x, l.y]), ...fusionnes.map((f) => [f.x, f.y])];
  const entieres = positions.filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y)).length;

  const heuresEgales = lots.filter((l) => l.fusionnes.length > 1 && new Set(l.fusionnes.map((f) => f.t)).size < l.fusionnes.length).length;
  const avecLot = lots.filter((l) => l.fusionnes.length > 1).length;
  const sansType = fusionnes.filter((f) => f.type !== "pen").length;
  const sansPression = fusionnes.filter((f) => !(f.p > 0)).length;

  const ecarts: number[] = [];
  for (let i = 1; i < lots.length; i++) ecarts.push(lots[i].t - lots[i - 1].t);
  const tries = [...ecarts].sort((a, b) => a - b);
  const median = tries[Math.floor(tries.length / 2)] ?? 0;
  const pressions = lots.map((l) => l.p).filter((p) => p > 0);
  let sautPression = 0;
  for (let i = 1; i < pressions.length; i++) sautPression += Math.abs(pressions[i] - pressions[i - 1]);

  return {
    "Navigateur": navigator.userAgent.replace(/^.*?\) /, ""),
    "Densité de l'écran": window.devicePixelRatio,
    "Événements": lots.length,
    "Traits commencés": poses,
    "Interruptions du système (pointercancel)": annulations,
    "Fréquence médiane": median > 0 ? `${Math.round(1000 / median)} Hz` : "—",
    "Plus long silence pendant un trait": `${Math.round(Math.max(0, ...ecarts.filter((e) => e < 400)))} ms`,
    "getCoalescedEvents": lots.some((l) => l.n > 0) ? "oui" : "absent",
    "Points par événement": lots.length ? (fusionnes.length / lots.length || 1).toFixed(1) : "—",
    "Points prédits par événement": lots.length ? (lots.reduce((s, l) => s + l.predits, 0) / lots.length).toFixed(1) : "—",
    "Coordonnées entières": pourcent(entieres, positions.length),
    "Lots aux horodatages identiques": pourcent(heuresEgales, avecLot),
    "Fusionnés sans type « pen »": pourcent(sansType, fusionnes.length),
    "Fusionnés sans pression": pourcent(sansPression, fusionnes.length),
    "Saut de pression moyen": pressions.length > 1 ? (sautPression / pressions.length).toFixed(4) : "—",
  };
}

export function DiagnosticStylet() {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const lots = React.useRef<Lot[]>([]);
  const dernier = React.useRef<{ x: number; y: number } | null>(null);
  const annulations = React.useRef(0);
  const poses = React.useRef(0);
  const [rapport, setRapport] = React.useState<Record<string, string | number> | null>(null);
  const [copie, setCopie] = React.useState(false);

  React.useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const d = window.devicePixelRatio || 1;
    const rect = el.getBoundingClientRect();
    el.width = Math.round(rect.width * d);
    el.height = Math.round(rect.height * d);
    const contexte = el.getContext("2d");
    if (!contexte) return;
    contexte.scale(d, d);
    contexte.lineWidth = 1;
    contexte.lineCap = "round";

    const point = (e: PointerEvent) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const trace = (e: PointerEvent) => {
      const p = point(e);
      const a = dernier.current ?? p;
      contexte.beginPath();
      contexte.moveTo(a.x, a.y);
      contexte.lineTo(p.x, p.y);
      contexte.stroke();
      dernier.current = p;
    };

    const bouge = (e: PointerEvent) => {
      if (!e.buttons) return;
      e.preventDefault();
      const liste = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const f of liste.length > 0 ? liste : [e]) trace(f);
      if (lots.current.length < LOTS_MAX) {
        lots.current.push({
          t: e.timeStamp,
          x: e.clientX,
          y: e.clientY,
          p: e.pressure,
          type: e.pointerType,
          n: liste.length,
          fusionnes: liste.map((f) => ({ t: f.timeStamp, x: f.clientX, y: f.clientY, p: f.pressure, type: f.pointerType })),
          predits: typeof e.getPredictedEvents === "function" ? e.getPredictedEvents().length : 0,
        });
      }
    };
    const pose = (e: PointerEvent) => {
      e.preventDefault();
      poses.current += 1;
      dernier.current = point(e);
      el.setPointerCapture(e.pointerId);
    };
    const annule = () => {
      annulations.current += 1;
    };
    const refuser = (e: TouchEvent) => e.preventDefault();

    el.addEventListener("pointerdown", pose);
    el.addEventListener("pointermove", bouge);
    el.addEventListener("pointercancel", annule);
    el.addEventListener("touchmove", refuser, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", pose);
      el.removeEventListener("pointermove", bouge);
      el.removeEventListener("pointercancel", annule);
      el.removeEventListener("touchmove", refuser);
    };
  }, []);

  async function copier() {
    const texte = JSON.stringify({ rapport, extrait: lots.current.slice(0, 200) });
    await navigator.clipboard.writeText(texte).catch(() => {});
    setCopie(true);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="m3-headline-medium text-on-surface">Diagnostic du stylet</h1>
        <p className="mt-1 m3-body-medium text-on-surface-variant">
          Écris une phrase normalement au Pencil, puis touche « Analyser ». Rien n&apos;est
          enregistré.
        </p>
      </header>
      <canvas
        ref={canvas}
        data-testid="diagnostic"
        className="h-[45svh] w-full rounded-xl border border-outline-variant bg-surface-lowest text-on-surface"
        style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setRapport(analyser(lots.current, annulations.current, poses.current))}>
          Analyser
        </Button>
        {rapport ? (
          <Button variant="outlined" onClick={copier}>
            {copie ? "Rapport copié" : "Copier le rapport"}
          </Button>
        ) : null}
      </div>
      {rapport ? (
        <dl className="grid gap-x-4 gap-y-1 rounded-xl bg-surface-container p-4 sm:grid-cols-[auto_1fr]">
          {Object.entries(rapport).map(([cle, valeur]) => (
            <React.Fragment key={cle}>
              <dt className="m3-body-small text-on-surface-variant">{cle}</dt>
              <dd className="m3-body-medium break-words tabular-nums text-on-surface">{valeur}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
