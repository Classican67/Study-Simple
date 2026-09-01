import type { Metadata } from "next";
import { Trash2 } from "lucide-react";

import { Badge, Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteUser } from "./actions";
import { UserForm } from "./user-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comptes" };

export default async function AdminPage() {
  const admin = await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      _count: { select: { decks: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="m3-headline-medium">Comptes</h1>
        <p className="mt-1 m3-body-medium text-on-surface-variant">
          L&apos;inscription est fermée : les comptes se créent uniquement ici ou en ligne de
          commande.
        </p>
      </div>

      <Panel>
        <h2 className="mb-4 font-semibold">Nouveau compte</h2>
        <UserForm />
      </Panel>

      <div>
        <h2 className="mb-3 font-semibold">
          {users.length} compte{users.length > 1 ? "s" : ""}
        </h2>
        <ul className="space-y-2">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex items-center gap-4 rounded-xl border border-outline-variant bg-surface-container px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {user.name}
                  {user.id === admin.id ? (
                    <span className="ml-2 text-xs font-normal text-on-surface-variant">(toi)</span>
                  ) : null}
                </p>
                <p className="truncate m3-body-medium text-on-surface-variant">{user.email}</p>
              </div>

              <Badge tone={user.role === "admin" ? "accent" : "neutral"}>
                {user.role === "admin" ? "Admin" : "Utilisateur"}
              </Badge>
              <Badge>
                {user._count.decks} paquet{user._count.decks > 1 ? "s" : ""}
              </Badge>

              {user.id === admin.id ? (
                // Pas de suppression de son propre compte : l'app pourrait se
                // retrouver sans aucun administrateur.
                <span className="w-10" />
              ) : (
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="text"
                      size="icon"
                      aria-label={`Supprimer le compte de ${user.name}`}
                      className="hover:text-error"
                    >
                      <Trash2 />
                    </Button>
                  }
                  title={`Supprimer le compte de ${user.name} ?`}
                  description="Ses paquets, ses cartes et sa progression seront effacés avec lui."
                  confirmLabel="Supprimer le compte"
                  action={deleteUser.bind(null, user.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
