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
  onLightboxChange,
}: {
  definition: string;
  imagePath?: string | null;
  className?: string;
  compact?: boolean;
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
      <RichText className={cn("min-w-0 flex-1", compact ? "text-sm" : "text-base")}>
        {definition}
      </RichText>

      {imagePath ? (
        <ImageLightbox
          src={`/api/uploads/${imagePath}`}
          alt="Illustration de la réponse"
          onOpenChange={onLightboxChange}
          thumbnailClassName={cn(
            "shrink-0",
            compact ? "max-h-24 w-auto" : "max-h-64 w-full sm:max-w-[45%]",
          )}
        />
      ) : null}
    </div>
  );
}
