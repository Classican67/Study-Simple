import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Flame, Target, Trophy } from "lucide-react";

import { CarteActivite, PrevisionEcheances } from "./graphiques";
import { toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { deckColor } from "@/lib/deck-colors";
import { bilanDeRevision } from "@/lib/statistiques-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bilan" };

/**
 * Le bilan : où j'en suis, et ce qui m'attend.
 *
 * Pas un tableau de bord pour le plaisir des courbes. Chaque bloc répond à une
 * question qu'on se pose vraiment avant un partiel — est-ce que je tiens le
 * rythme, combien de cartes demain, lesquelles me résistent — et les deux
 * derniers mènent directement à ce qu'il y a à faire.
 */
export default async function BilanPage() {
  const user = await requireUser();
  const bilan = await bilanDeRevision(user.id);

  if (bilan.cartes.total === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={<BarChart3 className="size-6" />}
          title="Rien à mesurer pour l'instant"
          description="Crée un paquet et révise quelques cartes : ton rythme et tes prévisions apparaîtront ici."
          action={
            <Button asChild>
              <Link href="/">Voir mes paquets</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const demain = bilan.prevision[1]?.cartes ?? 0;
  const dues = bilan.prevision[0]?.cartes ?? 0;
  const part = (n: number) => `${(n / bilan.cartes.total) * 100}%`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="m3-display-small text-on-surface">Bilan</h1>
        <p className="mt-2 m3-body-large text-on-surface-variant">
          {dues > 0
            ? `${dues} carte${dues > 1 ? "s" : ""} à revoir aujourd'hui, ${demain} demain.`
            : demain > 0
              ? `Rien aujourd'hui, ${demain} carte${demain > 1 ? "s" : ""} demain.`
              : "Rien à revoir aujourd'hui ni demain."}
        </p>
      </header>

      <section aria-label="En bref" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile icon={Flame} valeur={bilan.serie} unite={bilan.serie > 1 ? "jours" : "jour"} label="Série en cours" />
        <Tuile icon={Trophy} valeur={bilan.meilleureSerie} unite={bilan.meilleureSerie > 1 ? "jours" : "jour"} label="Meilleure série" />
        <Tuile icon={BarChart3} valeur={bilan.aujourdhui} unite={bilan.aujourdhui > 1 ? "réponses" : "réponse"} label="Aujourd'hui" />
        <Tuile
          icon={Target}
          valeur={bilan.reussite30j === null ? "—" : `${bilan.reussite30j} %`}
          label={`Réussite sur 30 jours${bilan.reponses30j ? ` · ${bilan.reponses30j} réponses` : ""}`}
        />
      </section>

      <Bloc titre="Régularité" sous="Les 26 dernières semaines">
        <CarteActivite colonnes={bilan.grille} />
      </Bloc>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloc titre="Ce qui arrive" sous="Cartes à revoir, jour par jour">
          <PrevisionEcheances jours={bilan.prevision} />
          {dues > 0 ? (
            <Button asChild className="mt-4 w-full sm:w-auto">
              <Link href="/study">Réviser maintenant</Link>
            </Button>
          ) : null}
        </Bloc>

        <Bloc titre="Où j'en suis" sous={`${bilan.cartes.total} cartes en tout`}>
          <div
            aria-hidden
            className="flex h-4 gap-0.5 overflow-hidden rounded-full"
          >
            {bilan.cartes.connues > 0 ? <span className="bg-primary" style={{ width: part(bilan.cartes.connues) }} /> : null}
            {bilan.cartes.aRevoir > 0 ? <span className="bg-tertiary" style={{ width: part(bilan.cartes.aRevoir) }} /> : null}
            {bilan.cartes.nouvelles > 0 ? <span className="bg-surface-highest" style={{ width: part(bilan.cartes.nouvelles) }} /> : null}
          </div>
          <dl className="mt-3 space-y-1 m3-body-medium text-on-surface">
            <Legende couleur="bg-primary" label="Acquises" valeur={bilan.cartes.connues} />
            <Legende couleur="bg-tertiary" label="À revoir" valeur={bilan.cartes.aRevoir} />
            <Legende couleur="bg-surface-highest" label="Jamais vues" valeur={bilan.cartes.nouvelles} />
          </dl>
        </Bloc>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloc titre="Paquets à travailler" sous="Les moins acquis d'abord">
          <ul className="space-y-1">
            {bilan.paquets.map((paquet) => {
              const pourcent = Math.round((paquet.connues / paquet.total) * 100);
              return (
                <li key={paquet.id}>
                  <Link
                    href={`/decks/${paquet.id}`}
                    className="state-layer block rounded-lg px-2 py-2"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate m3-body-medium text-on-surface">{paquet.title}</span>
                      <span className="shrink-0 tabular-nums m3-label-medium text-on-surface-variant">
                        {pourcent} %
                      </span>
                    </span>
                    <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-high">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${pourcent}%`, backgroundColor: deckColor(paquet.color) }}
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Bloc>

        <Bloc titre="Cartes qui résistent" sous="Les plus souvent ratées">
          {bilan.difficiles.length === 0 ? (
            <p className="m3-body-medium text-on-surface-variant">Aucune pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-1">
              {bilan.difficiles.map((carte) => (
                <li key={carte.id}>
                  <Link
                    href={`/decks/${carte.deckId}#card-${carte.id}`}
                    className="state-layer flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate m3-body-medium text-on-surface">
                        {toPlainText(carte.term)}
                      </span>
                      <span className="block truncate m3-body-small text-on-surface-variant">{carte.deck}</span>
                    </span>
                    <span className="shrink-0 tabular-nums m3-label-medium text-on-surface-variant">
                      {carte.rates} raté{carte.rates > 1 ? "s" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>
    </div>
  );
}

function Tuile({
  icon: Icon,
  valeur,
  unite,
  label,
}: {
  icon: React.ElementType;
  valeur: number | string;
  unite?: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl bg-surface-container p-4">
      <Icon aria-hidden className="size-5 text-on-surface-variant" />
      <p className="mt-3 m3-headline-medium tabular-nums text-on-surface">
        {valeur}
        {unite ? <span className="ml-1.5 m3-body-medium text-on-surface-variant">{unite}</span> : null}
      </p>
      <p className="mt-1 m3-body-small text-on-surface-variant">{label}</p>
    </div>
  );
}

function Bloc({ titre, sous, children }: { titre: string; sous: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface-container p-4 sm:p-5">
      <h2 className="m3-title-medium text-on-surface">{titre}</h2>
      <p className="mb-4 m3-body-small text-on-surface-variant">{sous}</p>
      {children}
    </section>
  );
}

function Legende({ couleur, label, valeur }: { couleur: string; label: string; valeur: number }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={`size-3 rounded-[3px] ${couleur}`} />
      <dt className="flex-1">{label}</dt>
      <dd className="tabular-nums text-on-surface-variant">{valeur}</dd>
    </div>
  );
}
