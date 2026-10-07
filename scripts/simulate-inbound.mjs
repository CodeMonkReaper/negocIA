// Simula un mensaje entrante de WhatsApp (firma HMAC + POST al webhook local).
//
// Uso:
//   pnpm webhook:test "hola, que ofrecen?"
//   pnpm webhook:test "hola" --from 56935019158 --name "Luis QA"
//
// Equivale exacto a que Meta entregara el mensaje: el worker lo persiste,
// lo pasa al motor (llm-jobs) y la respuesta llega al celular como OUTBOUND real.
// Útil mientras el número de negocio sea el de prueba de Meta (los teléfonos
// reales no pueden escribirle a un +1 555 de sandbox).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1/whatsapp/webhook";

function loadEnv(rootEnv) {
  const env = {};
  try {
    for (const line of readFileSync(rootEnv, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* sin .env: falla abajo con mensaje claro */ }
  return env;
}

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith("--")) ?? "hola, prueba IA";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const env = loadEnv(resolve(process.cwd(), ".env"));
const secret = process.env.META_WEBHOOK_APP_SECRET ?? env.META_WEBHOOK_APP_SECRET;
if (!secret) {
  console.error("Falta META_WEBHOOK_APP_SECRET (exportalo o definelo en .env)");
  process.exit(1);
}

const wamid = `wamid.sim-${Date.now()}`;
const from = opt("from", "56935019158");
const payload = {
  object: "whatsapp_business_account",
  entry: [{
    id: opt("waba-id", "1131932582688847"),
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: opt("display-phone", "15556356017"),
          phone_number_id: opt("phone-number-id", "1396319933558893"),
        },
        contacts: [{ profile: { name: opt("name", "QA") }, wa_id: from }],
        messages: [{
          from,
          id: wamid,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: text },
        }],
      },
    }],
  }],
};

const raw = JSON.stringify(payload);
const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const res = await fetch(API, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
  body: raw,
});
console.log("HTTP", res.status, await res.text());
console.log("wamid:", wamid);
console.log("Revisa tu celular en ~30s (worker debe estar corriendo: pnpm --filter @negocia/api start:worker)");
