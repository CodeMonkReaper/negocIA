export type EmailTemplate =
  | "verification"
  | "invitation"
  | "reset-password";

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  /** Token opaco incluido en el cuerpo del email (verificación/invitación). */
  token?: string;
  expiresAt?: Date;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}