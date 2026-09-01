"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  // useFormStatus doit vivre dans un enfant du <form> pour voir son état.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      <LogIn />
      {pending ? "Connexion…" : "Se connecter"}
    </Button>
  );
}

export function LoginForm({ from }: { from: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="from" value={from} />

      <Field label="Courriel" htmlFor="email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="toi@exemple.com"
        />
      </Field>

      <Field label="Mot de passe" htmlFor="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-error-container/10 px-3 py-2 text-sm text-error"
        >
          <TriangleAlert className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
