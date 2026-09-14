import * as React from "react";

/**
 * Rejet de la paume sur les commandes.
 *
 * Le rejet de la paume existe déjà **sur la feuille** : dès qu'un stylet a
 * servi, le doigt n'écrit plus. Mais la barre d'outils et le repère de page
 * flottent en bas de l'écran — exactement là où la main se pose pour écrire.
 * La paume y déclenchait ce qu'un doigt y déclencherait : la sélection de
 * texte d'iPadOS, le menu de l'appui prolongé, et parfois un bouton.
 *
 * Une application native n'a pas ce problème : le système lui livre les
 * contacts avec leur **surface**, et elle écarte ce qui est trop large pour
 * être un doigt. Le navigateur expose la même chose — `radiusX` / `radiusY`
 * sur un `Touch` — et c'est ce qu'on emploie ici, avec deux garde-fous qui se
 * complètent :
 *
 * 1. **La taille du contact.** Une pulpe de doigt fait vingt à trente pixels,
 *    le tranchant d'une main en fait cinquante à cent cinquante. C'est le seul
 *    critère qui marche quand la main se pose **avant** que le stylet ne
 *    touche — ce qui est l'ordre naturel du geste.
 * 2. **Le stylet en contact.** Pendant qu'on écrit, aucun doigt n'a rien à
 *    faire sur les commandes. Le délai de grâce couvre le moment où l'on lève
 *    la pointe sans avoir encore décollé la main.
 *
 * Rien de tout cela ne s'applique tant qu'aucun stylet n'a servi : sur un
 * portable ou au doigt, la barre d'outils doit répondre normalement.
 */

/** Un contact plus large que cela n'est pas un doigt. */
const RAYON_PAUME = 35;

/** Après le lever de la pointe, la main traîne encore un peu. */
const GRACE_MS = 700;

const etat = {
  /** Un stylet a servi dans cette session : le rejet de la paume a un sens. */
  stylet: false,
  /** La pointe est en contact. */
  pose: false,
  /** Dernier lever de pointe. */
  leve: 0,
};

/*
 * Pendant qu'on écrit, **aucun geste du navigateur** ne doit démarrer.
 *
 * C'est la cause d'un tracé qui s'interrompt tout seul. Quand la main se pose à
 * côté de la feuille — sur la barre d'outils, sur le repère de page, ou
 * simplement sur la page autour — Safari y voit le début d'un geste : défilement,
 * pincement, reconnaissance système. Il prend alors la main et **annule** le
 * pointeur du stylet, par un `pointercancel`. Le trait se coupe net, au milieu
 * d'un mot, sans que rien ne l'explique.
 *
 * Couper le geste à la racine demande un `preventDefault` sur `touchstart`, au
 * niveau du document et **à la capture** : le contact peut tomber n'importe où,
 * y compris hors de la surface d'écriture. L'écouteur n'existe que pendant le
 * tracé, et il ne gêne rien — on ne fait pas défiler la page en écrivant.
 *
 * Les événements de pointeur, eux, ne sont pas touchés : le canevas continue de
 * recevoir le stylet, et la vue se pince toujours à deux doigts dès que la
 * pointe est levée.
 */
let couperGestes: ((event: TouchEvent) => void) | null = null;
let releverPointe: ((event: PointerEvent) => void) | null = null;
let chienDeGarde = 0;

/**
 * Durée au-delà de laquelle la barrière se lève d'elle-même.
 *
 * La barrière empêche **tout** geste du navigateur : si elle restait posée, ni
 * la page ni les listes ne défileraient plus, et rien à l'écran ne dirait
 * pourquoi. Elle ne dépend donc pas du seul signal de fin — un canevas démonté
 * au milieu d'un trait ne l'enverrait jamais. Quinze secondes : plus qu'il n'en
 * faut pour le plus long des traits, moins qu'il n'en faut pour croire l'app
 * figée.
 */
const GARDE_MS = 15000;

function barrerGestes(actif: boolean) {
  if (typeof document === "undefined") return;

  window.clearTimeout(chienDeGarde);
  if (actif) {
    chienDeGarde = window.setTimeout(() => {
      etat.pose = false;
      barrerGestes(false);
    }, GARDE_MS);
  }

  if (actif && !couperGestes) {
    couperGestes = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    // Le lever de pointe peut se produire hors du canevas — ou ne jamais lui
    // parvenir, si le navigateur lui a retiré le pointeur. On l'écoute donc
    // aussi ici : c'est ce qui garantit que la barrière retombe.
    releverPointe = (event: PointerEvent) => {
      if (event.pointerType !== "pen") return;
      etat.pose = false;
      etat.leve = Date.now();
      barrerGestes(false);
    };
    document.addEventListener("touchstart", couperGestes, { capture: true, passive: false });
    document.addEventListener("touchmove", couperGestes, { capture: true, passive: false });
    document.addEventListener("pointerup", releverPointe, true);
    document.addEventListener("pointercancel", releverPointe, true);
  } else if (!actif && couperGestes) {
    document.removeEventListener("touchstart", couperGestes, true);
    document.removeEventListener("touchmove", couperGestes, true);
    if (releverPointe) {
      document.removeEventListener("pointerup", releverPointe, true);
      document.removeEventListener("pointercancel", releverPointe, true);
      releverPointe = null;
    }
    couperGestes = null;
  }
}

/** Prévient que la pointe touche la feuille, ou la quitte. */
export function signalerStylet(pose: boolean) {
  etat.stylet = true;
  etat.pose = pose;
  if (!pose) etat.leve = Date.now();
  barrerGestes(pose);
}

/** Écrit-on en ce moment même ? */
export function styletEnCours(): boolean {
  if (!etat.stylet) return false;
  return etat.pose || Date.now() - etat.leve < GRACE_MS;
}

/** Ce contact ressemble-t-il à une main posée plutôt qu'à un doigt ? */
export function contactDePaume(touch: Touch): boolean {
  if (!etat.stylet) return false;
  // Les rayons valent zéro quand le navigateur ne les connaît pas : on ne
  // conclut alors rien, plutôt que de refuser tous les contacts.
  const rayon = Math.max(touch.radiusX || 0, touch.radiusY || 0);
  return rayon > RAYON_PAUME;
}

/**
 * Protège un élément de commande contre la main posée.
 *
 * Les écouteurs sont posés **à la capture** et sur l'élément lui-même : il
 * faut couper le geste avant que quiconque ne le voie, y compris le navigateur.
 * `touchstart` est le seul point où l'on puisse empêcher à la fois la
 * sélection, le menu système et le clic qui suivrait — et il doit pour cela
 * être déclaré non passif, faute de quoi `preventDefault` est ignoré.
 */
export function usePalmGuard<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /*
     * Dernier contact refusé.
     *
     * Le clic de compatibilité arrive après le contact, sans qu'on puisse le
     * rattacher à celui qui l'a produit : on le reconnaît donc à sa position et
     * à sa fraîcheur. La fenêtre est courte **exprès** — refuser tout clic
     * pendant une seconde mangeait le geste du doigt qui suivait, et la barre
     * devenait sourde juste après qu'on ait posé la main.
     */
    let refuse = { t: 0, x: 0, y: 0 };

    const paume = (touches: TouchList) => {
      for (const touch of Array.from(touches)) {
        if (contactDePaume(touch)) return true;
      }
      return styletEnCours();
    };

    const surTouche = (event: TouchEvent) => {
      if (!paume(event.changedTouches)) return;
      const contact = event.changedTouches[0];
      refuse = { t: Date.now(), x: contact?.clientX ?? 0, y: contact?.clientY ?? 0 };
      event.preventDefault();
      event.stopPropagation();
    };

    const surPointeur = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !styletEnCours()) return;
      refuse = { t: Date.now(), x: event.clientX, y: event.clientY };
      event.preventDefault();
      event.stopPropagation();
    };

    /*
     * Le clic de compatibilité survit à `preventDefault` sur `pointerdown` :
     * sans cette dernière barrière, la paume appuierait quand même le bouton.
     * Sur iOS, couper `touchstart` suffit à l'empêcher — ceci est la ceinture,
     * pour les navigateurs qui n'en tiennent pas compte. Elle ne vaut donc que
     * pour le clic **de ce contact-là** : même endroit, tout de suite après.
     */
    const surClic = (event: MouseEvent) => {
      if (Date.now() - refuse.t > 400) return;
      if (Math.hypot(event.clientX - refuse.x, event.clientY - refuse.y) > 30) return;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener("touchstart", surTouche, { capture: true, passive: false });
    el.addEventListener("pointerdown", surPointeur, true);
    el.addEventListener("click", surClic, true);
    return () => {
      el.removeEventListener("touchstart", surTouche, true);
      el.removeEventListener("pointerdown", surPointeur, true);
      el.removeEventListener("click", surClic, true);
    };
  }, []);

  return ref;
}
