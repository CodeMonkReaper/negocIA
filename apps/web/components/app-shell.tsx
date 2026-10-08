"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Panel" },
  { href: "/conversations", label: "Conversaciones" },
  { href: "/whatsapp", label: "WhatsApp" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, tenant, membership, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold tracking-tight text-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm">
              n
            </span>
            negocIA
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    active
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:text-neutral-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-neutral-100">
                {user?.name}
              </p>
              <p className="text-xs text-neutral-500">
                {tenant?.name} · {membership?.role}
              </p>
            </div>
            <button
              onClick={() => {
                void handleLogout();
              }}
              className="rounded-lg border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}