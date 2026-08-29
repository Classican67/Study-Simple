"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { FolderInput } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { FolderOption } from "@/lib/folders";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Déplacement…" : "Déplacer"}
    </Button>
  );
}

/**
 * Déplacement d'un paquet ou d'un dossier vers un autre dossier.
 *
 * Les options arrivent déjà filtrées par le serveur : la branche du dossier
 * déplacé en est retirée, sinon on pourrait le ranger dans lui-même.
 */
export function MoveDialog({
  trigger,
  title,
  currentParentId,
  options,
  action,
}: {
  trigger?: React.ReactNode;
  title: string;
  currentParentId: string | null;
  options: FolderOption[];
  action: (destination: string | null) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [destination, setDestination] = React.useState(currentParentId ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label="Déplacer">
            <FolderInput />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={title} className="sm:max-w-md">
        <form
          action={async () => {
            await action(destination || null);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="move-destination" className="text-sm font-medium text-fg">
              Destination
            </label>
            <select
              id="move-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Accueil (aucun dossier)</option>
              {options.map((option) => (
                <option key={option.id} value={option.id} disabled={option.disabled}>
                  {/* Les espaces insécables matérialisent la profondeur : un
                      <option> n'accepte pas de mise en forme. */}
                  {"  ".repeat(option.depth)}
                  {option.depth > 0 ? "└ " : ""}
                  {option.label}
                  {option.disabled ? " (trop profond)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Annuler
              </Button>
            </DialogClose>
            <Submit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
