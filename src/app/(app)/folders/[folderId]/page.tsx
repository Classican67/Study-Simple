import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getFolderForUser, getFolderView, listFolderOptions } from "@/lib/folders";
import { FolderBrowser } from "../../browser";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/folders/[folderId]">,
): Promise<Metadata> {
  const { folderId } = await props.params;
  const user = await requireUser();
  const folder = await getFolderForUser(folderId, user.id);
  return { title: folder?.name ?? "Dossier" };
}

export default async function FolderPage(props: PageProps<"/folders/[folderId]">) {
  const { folderId } = await props.params;
  const user = await requireUser();

  const view = await getFolderView(user.id, folderId);
  // Dossier inexistant et dossier d'un autre compte donnent la même réponse.
  if (!view) notFound();

  // On retire la branche du dossier courant : il ne peut pas se ranger en
  // lui-même, ni dans l'un de ses descendants.
  // Le dossier ouvert est retiré des destinations du dossier lui-même, pas de
  // celles des paquets qu'il contient : ils peuvent descendre dans un
  // sous-dossier.
  const [options, moveTargets] = await Promise.all([
    listFolderOptions(user.id, folderId),
    listFolderOptions(user.id),
  ]);
  return <FolderBrowser view={view} folderOptions={options} moveTargets={moveTargets} />;
}
