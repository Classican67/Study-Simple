/**
 * Ce que la page hors ligne doit montrer, d'après l'adresse qu'on voulait ouvrir.
 *
 * Le service worker ne connaît rien de l'app : quand une navigation ne trouve
 * pas le serveur, il renvoie vers `/offline?de=<adresse demandée>`. C'est ici
 * qu'on retrouve l'intention — réviser tel paquet, ouvrir tel dossier — pour
 * la servir depuis l'appareil. Les liens de la page hors ligne restent donc
 * les **vraies** adresses de l'app : le réseau revenu, ils mènent à la vraie
 * page sans rien traduire.
 */

export type Destination =
  | { vue: "accueil"; indisponible: string | null }
  | { vue: "paquet"; id: string }
  | { vue: "dossier"; id: string }
  | { vue: "notes"; dossier: string | null }
  | { vue: "note"; id: string }
  | {
      vue: "revision";
      portee: { genre: "paquet"; id: string } | { genre: "dossier"; id: string } | { genre: "jour" };
      tout: boolean;
      ecrire: boolean;
    };

const ID = "([A-Za-z0-9_-]{1,64})";

export function lireDestination(de: string | null | undefined): Destination {
  if (!de || !de.startsWith("/") || de.startsWith("//")) return { vue: "accueil", indisponible: null };

  let url: URL;
  try {
    url = new URL(de, "http://fiches.invalid");
  } catch {
    return { vue: "accueil", indisponible: null };
  }
  const chemin = url.pathname.replace(/\/+$/, "") || "/";
  const tout = url.searchParams.get("all") === "1";
  const ecrire = url.searchParams.get("mode") === "write";

  let m: RegExpMatchArray | null;
  if (chemin === "/") return { vue: "accueil", indisponible: null };
  if (chemin === "/study") return { vue: "revision", portee: { genre: "jour" }, tout: false, ecrire: false };
  if ((m = chemin.match(new RegExp(`^/decks/${ID}/study$`))))
    return { vue: "revision", portee: { genre: "paquet", id: m[1] }, tout, ecrire };
  if ((m = chemin.match(new RegExp(`^/folders/${ID}/study$`))))
    return { vue: "revision", portee: { genre: "dossier", id: m[1] }, tout, ecrire: false };
  if ((m = chemin.match(new RegExp(`^/decks/${ID}$`)))) return { vue: "paquet", id: m[1] };
  if ((m = chemin.match(new RegExp(`^/folders/${ID}$`)))) return { vue: "dossier", id: m[1] };
  if (chemin === "/notes") {
    const dossier = url.searchParams.get("folder");
    return { vue: "notes", dossier: dossier && new RegExp(`^${ID}$`).test(dossier) ? dossier : null };
  }
  if ((m = chemin.match(new RegExp(`^/notes/${ID}$`)))) return { vue: "note", id: m[1] };

  return { vue: "accueil", indisponible: chemin };
}

/**
 * Un clic sur un lien interne doit-il devenir une navigation complète ?
 *
 * Hors ligne, la navigation de Next demande au serveur la charge utile de la
 * page suivante, échoue, et laisse l'écran figé ou sur une erreur. Une
 * navigation complète passe au contraire par le service worker, qui sait
 * servir la page hors ligne. On ne détourne que le clic simple : un clic
 * molette ou avec modificateur garde son sens.
 */
export function lienADetourner(
  evenement: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  lien: { href: string; target: string; hasAttribute(nom: string): boolean } | null,
  origine: string,
): string | null {
  if (!lien || evenement.defaultPrevented || evenement.button !== 0) return null;
  if (evenement.metaKey || evenement.ctrlKey || evenement.shiftKey || evenement.altKey) return null;
  if (lien.target && lien.target !== "_self") return null;
  if (lien.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(lien.href);
  } catch {
    return null;
  }
  if (url.origin !== origine) return null;
  return url.pathname + url.search + url.hash;
}
