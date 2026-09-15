"use client";

import * as React from "react";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/image-cropper";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-path";
import { addPhotoBlock } from "@/app/(app)/notes/actions";

/**
 * Photographier une page, et écrire dessus.
 *
 * Le tableau du cours, la page d'un camarade, un schéma d'un livre : on les
 * photographie pour les annoter. La photo devient une **page manuscrite** —
 * pas un bloc d'image à part — et hérite donc de tout ce que la page sait
 * faire : le stylet, le surligneur, le zoom, le volet des pages, l'export.
 *
 * ## Un seul bouton
 *
 * Un `<input type="file" accept="image/*">` suffit : sur iPad, il ouvre le menu
 * du système — « Prendre une photo », « Photothèque », « Choisir un fichier ».
 * C'est exactement le choix qu'on veut offrir, et c'est l'appareil photo du
 * système qui s'occupe de la mise au point, de l'exposition et du flash.
 * `getUserMedia` obligerait à tout refaire, moins bien.
 *
 * ## Le recadrage n'est pas un luxe
 *
 * Une page photographiée l'est toujours de biais, avec la table autour. Le
 * recadreur — le même que celui des cartes — permet de la redresser et de
 * couper ce qui dépasse **avant** d'écrire dessus, quand c'est encore facile.
 *
 * Deux réglages le distinguent de son usage sur une carte, et chacun a sa
 * raison : une définition plus grande, parce qu'on zoome jusqu'à six fois sur
 * une page annotée ; et le **JPEG** plutôt que le WebP, parce qu'un PDF exporté
 * ne sait embarquer que le JPEG et le PNG.
 */

/** Assez de définition pour zoomer six fois sans voir les pixels. */
export const COTE_MAX = 2400;

/**
 * Format d'une image — hauteur sur largeur —, lu par le navigateur qui l'a déjà
 * en main. Partagé avec l'ajout d'une photo depuis la barre d'outils : les deux
 * chemins doivent donner à la page le même format.
 */
export async function lireFormatImage(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image illisible"));
      image.src = url;
    });
    return image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoNote({
  noteId,
  onAdded,
  onError,
}: {
  noteId: string;
  onAdded: (block: { id: string; kind: string; content: string }) => void;
  onError: (message: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [aRecadrer, setARecadrer] = React.useState<File | null>(null);
  const [envoi, setEnvoi] = React.useState(false);

  async function envoyer(file: File) {
    setEnvoi(true);
    try {
      const ratio = await lireFormatImage(file);
      const data = new FormData();
      data.set("photo", file);
      data.set("ratio", String(ratio));
      const result = await addPhotoBlock(noteId, data);
      if (result.ok) onAdded(result.block);
      else onError(result.error);
    } catch {
      // Une action peut être **rejetée**, pas seulement répondre non : sans ce
      // filet, le bouton resterait en chargement pour toujours.
      onError("La photo n'a pas pu être envoyée. Vérifie ta connexion.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // `image/*` plutôt qu'une liste : c'est ce qui fait apparaître
        // « Prendre une photo » dans le menu d'iOS.
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Remis à zéro tout de suite : reprendre deux fois la même photo doit
          // redéclencher l'événement.
          event.target.value = "";
          if (!file) return;
          // Refusé avant de décoder : une image absurde ferait tomber le
          // navigateur avant même le recadrage.
          if (file.size > MAX_UPLOAD_BYTES * 6) {
            onError("Photo beaucoup trop lourde.");
            return;
          }
          setARecadrer(file);
        }}
      />

      <Button
        variant="outlined"
        onClick={() => inputRef.current?.click()}
        disabled={envoi}
        title="Photographier une page, ou en choisir une, pour l'annoter"
      >
        {envoi ? <Loader2 className="animate-spin" /> : <Camera />}
        Photo
      </Button>

      {aRecadrer ? (
        <ImageCropper
          // Remonté pour chaque photo : le cadre et la rotation de la
          // précédente n'ont rien à faire sur celle-ci.
          key={`${aRecadrer.name}-${aRecadrer.size}-${aRecadrer.lastModified}`}
          file={aRecadrer}
          maxSide={COTE_MAX}
          type="image/jpeg"
          onCancel={() => setARecadrer(null)}
          onConfirm={(recadree) => {
            setARecadrer(null);
            void envoyer(recadree);
          }}
        />
      ) : null}
    </>
  );
}
