import { ImageLightbox } from "@/components/image-lightbox";
import { RichText } from "@/components/rich-text";
import { cn } from "@/lib/utils";

// Rendu commun de la face « réponse » : texte à gauche, image à droite sur
// écran large, empilés en dessous. Sert à la fois dans la liste, dans la
// modale d'agrandissement et sur la carte en révision.
export function AnswerView({
  definition,
  imagePath,
  className,
  compact = false,
  showcase = false,
  onLightboxChange,
}: {
  definition: string;
  imagePath?: string | null;
  className?: string;
  compact?: boolean;
  /**
   * Mode révision : la réponse occupe la carte. Sans image, elle est agrandie
   * et centrée — le texte est alors le seul contenu, autant qu'il se lise de
   * loin ; avec une image, il reste aligné à gauche pour rester lisible en
   * colonne à côté d'elle.
   */
  showcase?: boolean;
  // Remonte l'ouverture de la visionneuse : en révision, la carte doit alors
  // rendre le clavier à la visionneuse.
  onLightboxChange?: (open: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        // `flex-wrap` : le schéma se met sous le texte dès qu'il ne reste plus
        // de quoi lire une colonne à côté de lui — la rangée se rompt sur la
        // largeur réelle de l'image, pas sur une taille d'écran.
        imagePath && !compact && "sm:flex-row sm:flex-wrap sm:items-start",
        className,
      )}
    >
      <RichText
        className={cn(
          "min-w-0 shrink grow basis-auto",
          // La base du texte décide de la rupture de rangée : elle n'a de sens
          // qu'en rangée. En colonne, `basis` porte sur la **hauteur**, et un
          // `sm:basis-80` posé là gonflerait de 320 px le bloc de texte d'une
          // réponse sans image. Pas `flex-1` non plus : sa forme courte remet
          // la base à zéro, et c'est justement elle qui compte ici.
          imagePath && !compact && "sm:basis-80",
          compact && "text-sm",
          !compact && !showcase && "text-base",
          showcase && imagePath && "text-base sm:text-lg",
          showcase && !imagePath && "text-balance text-center text-xl leading-snug sm:text-2xl",
        )}
      >
        {definition}
      </RichText>

      {imagePath ? (
        <ImageLightbox
          src={`/api/uploads/${imagePath}`}
          alt="Illustration de la réponse"
          onOpenChange={onLightboxChange}
          // Un schéma large prenait toute la rangée et chassait le texte : un
          // élément flex ne descend pas sous la largeur de son image
          // (`min-width: auto`), alors que la colonne de texte, elle, se laisse
          // réduire à rien — mesurée à 2 px de large pour 3364 px de haut, une
          // lettre par ligne. `min-w-0` lève ce plancher : l'image peut alors
          // rétrécir pour tenir, et la rangée peut se rompre sous elle.
          className="min-w-0"
          // `w-auto` plutôt qu'une largeur imposée : un schéma n'est jamais
          // agrandi au-delà de sa taille réelle, où il deviendrait flou.
          thumbnailClassName={compact ? "max-h-24 w-auto" : "max-h-44 w-auto sm:max-h-56"}
        />
      ) : null}
    </div>
  );
}
