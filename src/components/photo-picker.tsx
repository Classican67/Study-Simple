"use client";

import * as React from "react";
import { Camera, ImagePlus, TriangleAlert } from "lucide-react";

import { ImageCropper } from "@/components/image-cropper";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-path";
import { cn } from "@/lib/utils";

/**
 * Choix d'une photo : appareil de l'appareil, ou fichier existant — puis
 * recadrage avant envoi.
 *
 * L'accès à l'appareil photo passe par `capture="environment"` sur un
 * `<input type="file">`, donc par l'application appareil photo du système.
 * C'est délibéré : `getUserMedia` obligerait à réimplémenter la mise au point,
 * l'exposition et le flash, et n'a pas accès au traitement d'image de l'iPad.
 */
export function PhotoPicker({
  onPicked,
  disabled,
  className,
}: {
  onPicked: (file: File) => void;
  disabled?: boolean;
  className?: string;
}) {
  // `isSecureContext` ne change jamais pendant la vie de la page, mais le
  // serveur ne peut pas le connaître : useSyncExternalStore évite l'écart
  // entre le rendu serveur et le rendu client.
  const insecure = React.useSyncExternalStore(
    () => () => {},
    () => !window.isSecureContext,
    () => false,
  );

  const cameraRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function onSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Réinitialisé tout de suite : sans cela, reprendre deux fois la même
    // photo ne déclencherait pas d'événement la seconde fois.
    event.target.value = "";
    if (!file) return;

    // Contrôle avant même le recadrage : inutile de décoder une image que le
    // serveur refusera. Le recadrage la réduira, mais un fichier absurde
    // ferait tomber le navigateur avant.
    if (file.size > MAX_UPLOAD_BYTES * 6) {
      setError("Photo beaucoup trop lourde.");
      return;
    }
    setError(null);
    setPending(file);
  }

  return (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        // Ouvre directement l'appareil photo plutôt que la photothèque.
        capture="environment"
        onChange={onSelect}
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={onSelect}
        className="sr-only"
        tabIndex={-1}
      />

      <div className={cn("flex flex-col gap-1.5", className)}>
        {/* Le bouton appareil photo n'apparaît que là où un appareil est
            plausible : `pointer: coarse` désigne un écran tactile, sans avoir
            à renifler la chaîne d'agent utilisateur. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className="hidden min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-outline px-3 m3-body-small text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50 [@media(pointer:coarse)]:flex"
        >
          <Camera className="size-4" />
          Appareil photo
        </button>

        {/* Hors contexte sécurisé (LAN en http://), les navigateurs restreignent
            l'accès à l'appareil photo. On n'enlève pas le bouton pour autant :
            sur iOS, le sélecteur de fichiers propose lui aussi « Prendre une
            photo ». Mais mieux vaut dire pourquoi ça peut échouer. */}
        {insecure ? (
          <p className="hidden items-start gap-1.5 text-[0.7rem] leading-snug text-on-surface-variant [@media(pointer:coarse)]:flex">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            L&apos;appareil photo demande une connexion HTTPS. Sans elle, passe par
            « Image ».
          </p>
        ) : null}

        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-outline px-3 py-3 text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <ImagePlus className="size-5" />
          <span className="text-xs">Image</span>
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-error">
          {error}
        </p>
      ) : null}

      {pending ? (
        <ImageCropper
          // Remonte le recadreur pour chaque nouvelle photo : son état
          // (rotation, cadre) ne doit rien conserver de la précédente.
          key={`${pending.name}-${pending.size}-${pending.lastModified}`}
          file={pending}
          onCancel={() => setPending(null)}
          onConfirm={(cropped) => {
            setPending(null);
            onPicked(cropped);
          }}
        />
      ) : null}
    </>
  );
}
