"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/**
 * Guarda de rutas del panel: mientras se restaura la sesión muestra un
 * spinner; sin sesión redirige a /login.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Cargando sesión…" />
      </div>
    );
  }

  if (status === "anonymous") {
    return null;
  }

  return <>{children}</>;
}