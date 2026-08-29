import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getFolderView, listFolderOptions } from "@/lib/folders";
import { FolderBrowser } from "./browser";

// Les paquets et la progression changent à chaque révision : rien à mettre en
// cache statique ici.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  // `null` = la racine, c'est-à-dire tout ce qui n'est rangé dans aucun dossier.
  const view = await getFolderView(user.id, null);
  if (!view) notFound();

  const options = await listFolderOptions(user.id);
  return <FolderBrowser view={view} folderOptions={options} />;
}
