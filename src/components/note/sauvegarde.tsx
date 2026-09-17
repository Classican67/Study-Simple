"use client";

import * as React from "react";
import {
  AlertTriangle,
  CloudOff,
  Cloud,
  Check,
  Download,
  LogIn,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  ancrerLeStockage,
  journalLocal,
  type Brouillon,
} from "@/lib/brouillons";
import { creerSauvegarde, type Diagnostic, type Verdict } from "@/lib/sauvegarde";
import { cn } from "@/lib/utils";
import { blocConfirme } from "@/lib/hors-ligne/client";

/**
 * Transport HTTP d'un brouillon, et **traduction d'un échec en conduite**.
 *
 * C'est tout l'intérêt d'être passé par une route plutôt que par une action
 * serveur : le code de réponse dit ce qu'il faut faire. Auparavant, une
 * promesse rejetée ne distinguait pas une coupure de réseau — qu'il faut
 * rejouer — d'une session expirée — qu'il faut signaler — ni d'un bloc trop
 * volumineux — qu'il ne sert à rien de renvoyer.
 */
export async function envoyerBrouillon(brouillon: Brouillon): Promise<Verdict> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api/notes/${brouillon.noteId}/blocks/${brouillon.blockId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: brouillon.content, seq: brouillon.seq }),
      // Le cookie de session, et pas de cache : un enregistrement ne se
      // rejoue pas depuis une réponse mise de côté.
      credentials: "same-origin",
      cache: "no-store",
      /*
       * Une redirection n'est **pas** un enregistrement.
       *
       * Suivie, une redirection vers /login rend la page de connexion avec un
       * 200 : `reponse.ok` serait vrai et l'app annoncerait fièrement avoir
       * enregistré la page dans un écran de login. La route rend 401, mais un
       * proxy ou une passerelle d'authentification placée devant, elle, redirige.
       * En `manual`, une redirection arrive avec le statut 0 et se voit.
       */
      redirect: "manual",
    });
  } catch {
    return { sort: "reseau" };
  }

  if (reponse.type === "opaqueredirect" || reponse.status === 0 || reponse.redirected) {
    return { sort: "session" };
  }
  if (reponse.ok) return { sort: "ok" };
  if (reponse.status === 401 || reponse.status === 403) return { sort: "session" };

  const message = await reponse
    .json()
    .then((corps) => (typeof corps?.error === "string" ? corps.error : null))
    .catch(() => null);

  if (reponse.status === 413 || reponse.status === 404 || reponse.status === 400) {
    return { sort: "refus", message: message ?? "Le serveur a refusé ce contenu." };
  }
  return { sort: "serveur", message: message ?? `Le serveur a répondu ${reponse.status}.` };
}

export type Reprise = { blockId: string; content: string };

/**
 * Branche la file de reprise sur la fenêtre, et retrouve les brouillons laissés
 * par une session précédente.
 *
 * `noteModifiee` est la date de dernière modification de la note **côté
 * serveur**. Elle départage le brouillon et la base sans rien ajouter au
 * schéma : `touch()` la met à jour à chaque enregistrement réussi, donc un
 * brouillon plus récent qu'elle est forcément un brouillon que le serveur n'a
 * jamais reçu — on peut le remettre sans risque d'écraser quoi que ce soit.
 */
export function useSauvegarde({
  noteId,
  noteModifiee,
  contenus,
  onReprise,
}: {
  noteId: string;
  noteModifiee: number;
  /** Ce que le serveur vient de rendre, par bloc : pour reconnaître un doublon. */
  contenus: () => Map<string, string>;
  onReprise: (reprises: Reprise[]) => void;
}) {
  const [diagnostic, setDiagnostic] = React.useState<Diagnostic>({
    etat: "repos",
    enAttente: 0,
    erreur: null,
    depuis: null,
    essais: 0,
  });
  /** Brouillons que la date du serveur ne permet pas de remettre d'office. */
  const [litiges, setLitiges] = React.useState<Brouillon[]>([]);
  const [repris, setRepris] = React.useState(0);

  const sauvegarde = React.useMemo(
    () =>
      creerSauvegarde({
        envoyer: async (brouillon) => {
          const verdict = await envoyerBrouillon(brouillon);
          // La copie gardée hors ligne suit ce que le serveur a confirmé — et
          // rien d'autre : cf. `blocConfirme`.
          if (verdict.sort === "ok") blocConfirme(brouillon.noteId, brouillon.blockId, brouillon.content);
          return verdict;
        },
        journal: journalLocal,
        // Sans cela, une coupure franche se présentait comme « Reprise en
        // cours » : la file tentait un envoi voué à l'échec au lieu de dire
        // qu'il n'y a pas de réseau. `navigator.onLine` ment dans un sens —
        // il annonce « en ligne » sur un réseau qui ne route rien — mais il ne
        // ment pas dans l'autre : faux veut dire faux.
        enLigne: () => navigator.onLine,
      }),
    [],
  );

  // Les rappels changent à chaque rendu de l'éditeur ; les effets ci-dessous
  // ne doivent pas se redéclencher pour autant.
  const dernierContenus = React.useRef(contenus);
  const dernierReprise = React.useRef(onReprise);
  React.useEffect(() => {
    dernierContenus.current = contenus;
    dernierReprise.current = onReprise;
  });

  React.useEffect(() => {
    const oublier = sauvegarde.ecouter(setDiagnostic);
    return () => {
      oublier();
    };
  }, [sauvegarde]);

  React.useEffect(() => {
    ancrerLeStockage();
    let vivant = true;

    void (async () => {
      const brouillons = await journalLocal.lire(noteId);
      if (!vivant || brouillons.length === 0) return;
      const deja = dernierContenus.current();
      const reprises: Reprise[] = [];
      const enLitige: Brouillon[] = [];

      for (const brouillon of brouillons) {
        // Déjà en base : l'enregistrement était passé, c'est l'effacement du
        // brouillon qui n'a pas eu lieu (onglet fermé entre les deux).
        if (deja.get(brouillon.blockId) === brouillon.content) {
          void journalLocal.oublier(brouillon.blockId, brouillon.seq);
          continue;
        }
        if (!deja.has(brouillon.blockId)) {
          // Le bloc n'existe plus : ne rien replacer dans une note qui ne
          // l'attend pas, mais garder le brouillon — il reste téléchargeable.
          enLitige.push(brouillon);
          continue;
        }
        if (brouillon.seq > noteModifiee) {
          reprises.push({ blockId: brouillon.blockId, content: brouillon.content });
          sauvegarde.reprendreBrouillon(brouillon);
        } else {
          // Le serveur porte du travail au moins aussi récent, venu d'ailleurs.
          // On ne tranche pas à la place de la personne.
          enLitige.push(brouillon);
        }
      }

      if (!vivant) return;
      if (reprises.length > 0) {
        dernierReprise.current(reprises);
        setRepris(reprises.length);
        sauvegarde.reprendre();
      }
      if (enLitige.length > 0) setLitiges(enLitige);
    })();

    return () => {
      vivant = false;
    };
  }, [noteId, noteModifiee, sauvegarde]);

  // Réveil de la file : retour du réseau, retour de l'onglet. iPadOS suspend
  // un onglet caché — le minuteur programmé n'a pas tourné pendant ce temps.
  React.useEffect(() => {
    const reveiller = () => sauvegarde.reprendre();
    const surVisibilite = () => {
      if (document.visibilityState === "visible") reveiller();
    };
    window.addEventListener("online", reveiller);
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      window.removeEventListener("online", reveiller);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [sauvegarde]);

  // Dernier rempart : prévenir avant de fermer sur du travail non parti. Le
  // journal l'a déjà sur le disque — mais qui ferme un onglet ne revient pas
  // toujours, et la reprise n'a lieu qu'à la réouverture de la note.
  React.useEffect(() => {
    if (diagnostic.enAttente === 0) return;
    const garder = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", garder);
    return () => window.removeEventListener("beforeunload", garder);
  }, [diagnostic.enAttente]);

  React.useEffect(() => () => sauvegarde.arreter(), [sauvegarde]);

  return {
    diagnostic,
    litiges,
    repris,
    oublierReprise: () => setRepris(0),
    enregistrer: (entree: { blockId: string; kind: string; content: string }) =>
      sauvegarde.enregistrer({ ...entree, noteId }),
    reessayer: () => sauvegarde.reessayer(),
    resoudreLitige: async (brouillon: Brouillon, garder: boolean) => {
      setLitiges((restants) => restants.filter((b) => b.blockId !== brouillon.blockId));
      if (garder) {
        dernierReprise.current([{ blockId: brouillon.blockId, content: brouillon.content }]);
        await sauvegarde.enregistrer({
          blockId: brouillon.blockId,
          noteId: brouillon.noteId,
          kind: brouillon.kind,
          content: brouillon.content,
        });
      } else {
        await sauvegarde.abandonner(brouillon.blockId);
      }
    },
    enSouffrance: () => sauvegarde.enSouffrance(),
  };
}

export type OutilsSauvegarde = ReturnType<typeof useSauvegarde>;

const APPARENCES: Record<
  Diagnostic["etat"],
  { libelle: string; icone: React.ElementType; classe: string; anime?: boolean }
> = {
  repos: { libelle: "Enregistré", icone: Check, classe: "bg-success-container text-on-success-container" },
  envoi: { libelle: "Enregistrement…", icone: Cloud, classe: "bg-surface-container text-on-surface-variant" },
  // Ton calme, et non `tertiary-container` : sur ce thème il tire au rose, à un
  // cheveu de `error-container`. « Hors ligne » se résout tout seul au retour du
  // réseau — le montrer comme une alarme fait craindre une perte au moment
  // précis où l'app garantit qu'il n'y en aura pas. L'alarme reste pour ce qui
  // demande un geste : se reconnecter, ou traiter un refus.
  attente: { libelle: "Reprise en cours", icone: RefreshCw, classe: "bg-secondary-container text-on-secondary-container", anime: true },
  "hors-ligne": { libelle: "Hors ligne", icone: CloudOff, classe: "bg-secondary-container text-on-secondary-container" },
  session: { libelle: "Session expirée", icone: LogIn, classe: "bg-error-container text-on-error-container" },
  refus: { libelle: "Non enregistré", icone: AlertTriangle, classe: "bg-error-container text-on-error-container" },
};

function telecharger(noteId: string, brouillons: Brouillon[]) {
  const fichier = {
    app: "fiches",
    format: "brouillons-v1",
    noteId,
    exporte: new Date().toISOString(),
    brouillons,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(fichier)], { type: "application/json" }),
  );
  const lien = document.createElement("a");
  lien.href = url;
  const horodatage = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  lien.download = `fiches-sauvegarde-${horodatage}.json`;
  lien.click();
  // Révoquer trop tôt annule le téléchargement sur Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * L'état de l'enregistrement, et la porte de sortie quand il ne passe plus.
 *
 * Une pastille « Enregistrement… » qui ne dit rien d'autre laisse deux
 * situations opposées se ressembler : « ça part » et « ça ne part plus depuis
 * vingt minutes ». Celle-ci nomme la panne, et le panneau derrière propose les
 * trois seules choses utiles à ce moment : réessayer, se reconnecter, ou
 * emporter son travail dans un fichier.
 */
export function EtatSauvegarde({
  noteId,
  outils,
  className,
}: {
  noteId: string;
  outils: OutilsSauvegarde;
  className?: string;
}) {
  const { diagnostic } = outils;
  const repos = diagnostic.etat === "repos";

  // « Enregistré » se montre un instant après coup, puis s'efface : une
  // pastille verte permanente devient un meuble qu'on ne lit plus. Un état
  // parlant, lui, reste affiché tant qu'il dure.
  const [masque, setMasque] = React.useState(true);
  const [vuEtat, setVuEtat] = React.useState(diagnostic.etat);
  if (vuEtat !== diagnostic.etat) {
    // Ajustement d'état pendant le rendu : la pastille doit se rallumer dans
    // la même image que le changement, sans le rendu de trop qu'imposerait un
    // effet.
    setVuEtat(diagnostic.etat);
    if (!repos) setMasque(false);
  }
  React.useEffect(() => {
    if (!repos || masque) return;
    const jeton = setTimeout(() => setMasque(true), 2200);
    return () => clearTimeout(jeton);
  }, [repos, masque]);
  const visible = !masque;

  const apparence = APPARENCES[diagnostic.etat];
  const Icone = apparence.icone;
  const souci = diagnostic.etat !== "repos" && diagnostic.etat !== "envoi";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="etat-sauvegarde"
          aria-live="polite"
          className={cn(
            "flex min-h-12 items-center gap-2 rounded-full px-4 m3-label-large elevation-2 transition-opacity",
            apparence.classe,
            visible ? "opacity-100" : "pointer-events-none opacity-0",
            className,
          )}
        >
          <Icone className={cn("size-4 shrink-0", apparence.anime && "animate-spin")} />
          {apparence.libelle}
          {souci && diagnostic.enAttente > 0 ? (
            <span className="rounded-full bg-black/10 px-2 dark:bg-white/15">
              {diagnostic.enAttente}
            </span>
          ) : null}
        </button>
      </DialogTrigger>

      <DialogContent
        title="Enregistrement"
        description={
          souci
            ? "Ton travail est conservé sur cet appareil. Il repartira tout seul dès que possible."
            : "Tout est enregistré sur le serveur."
        }
      >
        <PanneauSauvegarde noteId={noteId} outils={outils} />
      </DialogContent>
    </Dialog>
  );
}

function depuisQuand(depuis: number | null): string | null {
  if (depuis === null) return null;
  const minutes = Math.floor((Date.now() - depuis) / 60000);
  if (minutes < 1) return "il y a moins d'une minute";
  if (minutes === 1) return "il y a une minute";
  if (minutes < 60) return `il y a ${minutes} minutes`;
  const heures = Math.floor(minutes / 60);
  return heures === 1 ? "il y a plus d'une heure" : `il y a plus de ${heures} heures`;
}

function PanneauSauvegarde({ noteId, outils }: { noteId: string; outils: OutilsSauvegarde }) {
  const { diagnostic } = outils;
  // Lu au rendu : le panneau n'existe que lorsque la boîte est ouverte, et
  // `diagnostic` le fait se rendre à nouveau à chaque changement de la file.
  const attente = outils.enSouffrance();

  const souci = diagnostic.etat !== "repos" && diagnostic.etat !== "envoi";
  const quand = depuisQuand(diagnostic.depuis);

  return (
    <div className="space-y-4">
      {diagnostic.erreur ? (
        <p className="rounded-xl bg-error-container px-4 py-3 m3-body-medium text-on-error-container">
          {diagnostic.erreur}
        </p>
      ) : null}

      {souci ? (
        <p className="m3-body-medium text-on-surface-variant">
          {attente.length === 1 ? (
            <>
              Une modification n&apos;est pas encore partie{quand ? `, ${quand}` : ""}. Elle est
              écrite sur cet appareil : fermer l&apos;onglet ou couper la connexion ne la
              perdra pas, et rouvrir la note la remettra en place.
            </>
          ) : (
            <>
              {attente.length} modifications ne sont pas encore parties
              {quand ? `, ${quand}` : ""}. Elles sont écrites sur cet appareil : fermer
              l&apos;onglet ou couper la connexion ne les perdra pas, et rouvrir la note
              les remettra en place.
            </>
          )}
        </p>
      ) : (
        <p className="m3-body-medium text-on-surface-variant">
          Chaque modification est d&apos;abord écrite sur cet appareil, puis envoyée au
          serveur. Elle n&apos;est effacée d&apos;ici qu&apos;une fois le serveur
          confirmé — une coupure ne peut donc rien emporter.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="filled" onClick={outils.reessayer} disabled={attente.length === 0}>
          <RefreshCw />
          Réessayer maintenant
        </Button>

        {/* La porte de sortie : même serveur mort, le travail part avec la
            personne. Le fichier se relit par « Restaurer », ci-dessous. */}
        <Button
          variant="outlined"
          onClick={() => telecharger(noteId, attente)}
          disabled={attente.length === 0}
        >
          <Download />
          Télécharger une sauvegarde
        </Button>

        <RestaurerSauvegarde outils={outils} />

        {/* Dans un **autre** onglet, délibérément : quitter celui-ci pour aller
            se connecter fermerait la note sur son travail en attente. Le
            cookie rafraîchi vaut pour toute l'origine, et la file — qui
            réessaie toutes les dix secondes — repart alors toute seule. */}
        {diagnostic.etat === "session" ? (
          <Button variant="outlined" asChild>
            <a href="/login" target="_blank" rel="noreferrer">
              <LogIn />
              Se reconnecter dans un onglet
            </a>
          </Button>
        ) : null}
      </div>

      {attente.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-surface-lowest p-3">
          {attente.map((brouillon) => (
            <li
              key={brouillon.blockId}
              className="flex items-center justify-between gap-3 m3-body-small text-on-surface-variant"
            >
              <span className="truncate">
                {brouillon.kind === "drawing" ? "Page manuscrite" : brouillon.kind === "table" ? "Tableau" : "Texte"}
                {" · "}
                {new Date(brouillon.seq).toLocaleTimeString("fr-CA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                {Math.max(1, Math.round(brouillon.content.length / 1024))} Ko
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Relit un fichier de sauvegarde et remet ses brouillons dans la file. */
function RestaurerSauvegarde({ outils }: { outils: OutilsSauvegarde }) {
  const champ = React.useRef<HTMLInputElement>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function lire(fichier: File) {
    try {
      const contenu = JSON.parse(await fichier.text());
      const brouillons: Brouillon[] = Array.isArray(contenu?.brouillons) ? contenu.brouillons : [];
      const valides = brouillons.filter(
        (b) => typeof b?.blockId === "string" && typeof b?.content === "string",
      );
      if (valides.length === 0) {
        setMessage("Ce fichier ne contient aucune sauvegarde lisible.");
        return;
      }
      for (const brouillon of valides) {
        await outils.resoudreLitige(brouillon, true);
      }
      setMessage(
        valides.length === 1 ? "Une modification restaurée." : `${valides.length} modifications restaurées.`,
      );
    } catch {
      setMessage("Fichier illisible.");
    }
  }

  return (
    <>
      <Button variant="outlined" onClick={() => champ.current?.click()}>
        <Upload />
        Restaurer une sauvegarde
      </Button>
      <input
        ref={champ}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Fichier de sauvegarde à restaurer"
        onChange={(event) => {
          const fichier = event.target.files?.[0];
          event.target.value = "";
          if (fichier) void lire(fichier);
        }}
      />
      {message ? <p className="w-full m3-body-small text-on-surface-variant">{message}</p> : null}
    </>
  );
}

/**
 * Brouillons que la date du serveur ne permet pas de remettre d'office : la
 * note a été modifiée ailleurs depuis. On montre les deux versions plutôt que
 * d'en écraser une.
 *
 * Affiché **dans la note**, et non dans le panneau d'enregistrement : ce
 * panneau s'ouvre depuis la pastille, or la pastille est masquée quand tout est
 * enregistré — ce qui est précisément le cas ici, puisque ces brouillons ne sont
 * pas en attente d'envoi mais en attente d'une décision. Le choix serait resté
 * invisible pour toujours.
 */
export function LitigesSauvegarde({ outils }: { outils: OutilsSauvegarde }) {
  if (outils.litiges.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-outline-variant bg-surface-container p-3">
      <p className="m3-title-small text-on-surface">Versions retrouvées sur cet appareil</p>
      <p className="m3-body-small text-on-surface-variant">
        Ces modifications n&apos;ont jamais atteint le serveur, mais la note a été
        modifiée depuis — peut-être depuis un autre appareil. À toi de choisir.
      </p>
      {outils.litiges.map((brouillon) => (
        <div key={brouillon.blockId} className="flex flex-wrap items-center gap-2">
          <span className="flex-1 m3-body-small text-on-surface-variant">
            {brouillon.kind === "drawing" ? "Page manuscrite" : "Bloc"} du{" "}
            {new Date(brouillon.seq).toLocaleString("fr-CA", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </span>
          <Button variant="outlined" onClick={() => void outils.resoudreLitige(brouillon, true)}>
            Restaurer
          </Button>
          <Button variant="text" onClick={() => void outils.resoudreLitige(brouillon, false)}>
            <Trash2 />
            Jeter
          </Button>
        </div>
      ))}
    </div>
  );
}
