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
        imagePath && !compact && "sm:flex-row sm:items-start",
        className,
      )}
    >
      <RichText
        className={cn(
          "min-w-0 flex-1",
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
          // `w-auto` plutôt qu'une largeur imposée : un schéma n'est jamais
          // agrandi au-delà de sa taille réelle, où il deviendrait flou.
          thumbnailClassName={compact ? "max-h-24 w-auto" : "max-h-44 w-auto sm:max-h-56"}
        />
      ) : null}
    </div>
  );
}
