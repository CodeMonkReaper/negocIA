import { API_PREFIX } from "@negocia/contracts";
import { ApiStatus } from "@/components/api-status";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

const services = [
  { name: "API (NestJS)", port: 4000, path: `${API_PREFIX}/health` },
  { name: "Web (Next.js)", port: 3000, path: "/" },
  { name: "PostgreSQL 17", port: 5432, path: "docker: negocia-postgres" },
  { name: "Redis 7", port: 6379, path: "docker: negocia-redis" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-12 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          negocIA
        </h1>
        <p className="text-neutral-400">
          Monorepo foundation — Next.js + NestJS + PostgreSQL + Redis.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {services.map((service) => (
          <article
            key={service.name}
            className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5"
          >
            <h2 className="font-semibold text-neutral-100">{service.name}</h2>
            <p className="mt-1 font-mono text-sm text-neutral-400">
              {service.path}
            </p>
          </article>
        ))}
      </section>

      <ApiStatus apiBaseUrl={apiBaseUrl} />

      <footer className="border-t border-neutral-800 pt-6 text-sm text-neutral-500">
        API detectada en build:{" "}
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-300">
          {apiBaseUrl}
        </code>
      </footer>
    </main>
  );
}