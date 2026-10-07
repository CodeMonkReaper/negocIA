import { StructuredLogger } from "../common/logger/structured-logger";
import type {
  EmailMessage,
  EmailSender,
  EmailTemplate,
} from "../domain/ports";

/**
 * Opciones resueltas una vez en el composition root (EmailModule).
 *
 * `FROM_NAME` y `FROM` se componen en el adaptador; los emails no deben llevar
 * el `to` del usuario junto al `from` sin mostrar marca.
 */
export interface ResendEmailAdapterOptions {
  apiKey: string;
  from: string;
  fromName: string;
  /** Base de los enlaces de acción (validation: `APP_BASE_URL`). */
  baseUrl: string;
  logger?: Pick<StructuredLogger, "warn" | "debug">;
}

export interface ResendEmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Superficie mínima del cliente de Resend que el adaptador necesita.
 *
 * Se declara como interfaz para que los unit tests inyecten un doble sin mock
 * de módulo y sin red. El cliente real (`new Resend(apiKey)`) es estructuralmente
 * compatible: `emails.send` devuelve `Promise<unknown>`.
 */
export interface ResendClientLike {
  emails: {
    send(payload: ResendEmailPayload): Promise<unknown>;
  };
}

const SUBJECTS: Record<EmailTemplate, string> = {
  verification: "Confirma tu correo en negocIA",
  invitation: "Te invitaron a un espacio en negocIA",
  "reset-password": "Restablece tu contraseña de negocIA",
};

/** Ruta de la web de negocIA a la que apunta el botón del email. */
const ACTION_PATHS: Record<EmailTemplate, string> = {
  verification: "/verificar-email",
  invitation: "/invitacion",
  "reset-password": "/restablecer-password",
};

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: Date): string {
  return new Date(value).toLocaleString("es-ES", { dateStyle: "long" });
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Renderiza el mensaje de dominio a lo que Resend acepta.
 *
 * El token crudo solo viaja aquí: en el enlace de acción del cuerpo. Nunca se
 * persiste ni se registra (por eso `EmailMessage.token` no es logueable).
 */
function render(message: EmailMessage, options: ResendEmailAdapterOptions): RenderedEmail {
  const name = readString(message.data, "name");
  const tenantName = readString(message.data, "tenantName");
  const role = readString(message.data, "role");

  const greeting = name ? `Hola ${name},` : "Hola,";
  const actionUrl = `${options.baseUrl}${ACTION_PATHS[message.template]}?token=${encodeURIComponent(
    message.token ?? "",
  )}`;
  const expiresLine = message.expiresAt
    ? `Este enlace caduca el ${formatDate(message.expiresAt)}.`
    : "";

  const intro = perTemplateIntro(message.template, { tenantName, role });

  const text = [
    greeting,
    "",
    intro,
    "",
    "Para continuar, abre este enlace:",
    actionUrl,
    "",
    expiresLine,
    "",
    "Si no hiciste esta solicitud, ignora este correo.",
    "— El equipo de negocIA",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const htmlIntro = perTemplateIntroHtml(message.template, {
    tenantName,
    role,
  });

  const safeAction = escapeHtml(actionUrl);

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:28px 32px">
                <p style="font-size:16px;color:#111827">${escapeHtml(greeting)}</p>
                <p style="font-size:15px;color:#374151;line-height:1.6">${htmlIntro}</p>
                <p style="text-align:center;margin:28px 0">
                  <a href="${safeAction}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px">Abrir enlace</a>
                </p>
                <p style="font-size:13px;color:#6b7280">${escapeHtml(expiresLine)}</p>
                <p style="font-size:13px;color:#6b7280;margin-top:16px">Si no hiciste esta solicitud, ignora este correo.<br/>— El equipo de negocIA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: SUBJECTS[message.template], text, html };
}

function perTemplateIntro(
  template: EmailTemplate,
  ctx: { tenantName: string; role: string },
): string {
  switch (template) {
    case "verification":
      return `Confirma que este correo es tuyo para activar tu cuenta${ctx.tenantName ? ` en ${ctx.tenantName}` : ""}.`;
    case "invitation":
      return `Te invitaron${ctx.role ? ` como ${ctx.role}` : ""}${ctx.tenantName ? ` al espacio ${ctx.tenantName}` : ""} de negocIA.`;
    case "reset-password":
      return "Solicitamos restablecer la contraseña de tu cuenta.";
  }
}

function perTemplateIntroHtml(
  template: EmailTemplate,
  ctx: { tenantName: string; role: string },
): string {
  return escapeHtml(perTemplateIntro(template, ctx));
}

/**
 * Canal de email de producción (Resend).
 *
 * Un fallo del proveedor **no** se propaga al request: el token ya quedó
 * persistido antes de enviar (ver `EmailVerificationSender.send`), así que la
 * operación tiene efecto y el usuario puede pedir el reenvío. Lanzar aquí solo
 * conseguiría que una caída de Resend tumbara un alta de cuenta.
 */
export class ResendEmailAdapter implements EmailSender {
  private readonly logger: Pick<StructuredLogger, "warn" | "debug">;

  constructor(
    private readonly client: ResendClientLike,
    private readonly options: ResendEmailAdapterOptions,
  ) {
    this.logger = options.logger ?? StructuredLogger.fromEnv();
  }

  async send(message: EmailMessage): Promise<void> {
    const { subject, text, html } = render(message, this.options);
    const from = `${this.options.fromName} <${this.options.from}>`;

    try {
      await this.client.emails.send({ from, to: message.to, subject, html, text });
    } catch {
      this.logger.warn(
        message.template === "reset-password"
          ? "No se pudo enviar el email de reset de contraseña"
          : "No se pudo enviar el email solicitado",
        "ResendEmailAdapter",
      );
    }
  }
}