"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, TriangleAlert, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { createUser, type AdminState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <UserPlus />
      {pending ? "Création…" : "Créer le compte"}
    </Button>
  );
}

export function UserForm() {
  const [state, formAction] = useActionState<AdminState, FormData>(createUser, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" htmlFor="user-name">
          <Input name="name" required maxLength={80} placeholder="Camille" />
        </Field>
        <Field label="Courriel" htmlFor="user-email">
          <Input name="email" type="email" required placeholder="camille@exemple.com" />
        </Field>
      </div>

      <Field label="Mot de passe" htmlFor="user-password" hint="8 caractères minimum.">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>

      <Field label="Rôle" htmlFor="user-role" hint="Un administrateur peut créer et supprimer des comptes.">
        <select
          name="role"
          defaultValue="user"
          className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="user">Utilisateur</option>
          <option value="admin">Administrateur</option>
        </select>
      </Field>

      {state.error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="flex items-center gap-2 text-sm text-success">
          <CircleCheck className="size-4 shrink-0" />
          {state.ok}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
