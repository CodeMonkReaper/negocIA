"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    try {
      await register(name, email, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Crear cuenta">
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Nombre" htmlFor="name">
          <TextInput
            id="name"
            type="text"
            autoComplete="name"
            required
            placeholder="Tu emprendimiento"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tu@empresa.cl"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <TextInput
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Repetir contraseña" htmlFor="confirm">
          <TextInput
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-neutral-500">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-emerald-400 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </Card>
  );
}