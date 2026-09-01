import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

/**
 * Champs de saisie Material 3, variante « filled » : un fond teinté et un
 * soulignement qui s'épaissit au focus, plutôt qu'une bordure sur les quatre
 * côtés. C'est la forme par défaut du système Android.
 */
const controlStyles =
  "w-full rounded-t-sm border-0 border-b-2 border-outline bg-surface-high px-4 pb-2 pt-3 " +
  "m3-body-large text-on-surface placeholder:text-on-surface-variant/70 " +
  "transition-colors focus:border-primary focus:outline-none " +
  "disabled:opacity-38 aria-[invalid=true]:border-error";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("m3-label-large text-on-surface-variant", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlStyles, "h-14", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlStyles, "min-h-24 resize-y", className)} {...props} />;
}

/**
 * Regroupe libellé, champ, aide et message d'erreur, et câble
 * aria-describedby / aria-invalid : c'est ce qui rend l'erreur audible pour un
 * lecteur d'écran.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint ? (
        <p id={hintId} className="m3-body-small text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      {React.isValidElement<Record<string, unknown>>(children)
        ? React.cloneElement(children, {
            id: htmlFor,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
          })
        : children}
      {/* Material 3 affiche le message d'erreur sous le champ, dans la couleur
          d'erreur, précédé d'un espacement constant. */}
      {error ? (
        <p id={errorId} role="alert" className="px-4 m3-body-small text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
