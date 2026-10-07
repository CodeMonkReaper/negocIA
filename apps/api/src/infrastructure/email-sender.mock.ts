import type { EmailMessage, EmailSender } from "../domain/ports";

/**
 * Adaptador de email de mentira: guarda los mensajes en memoria.
 *
 * Existe porque el proveedor real está diferido. Guardar los mensajes en vez de
 * imprimirlos es deliberado: un token en la salida de un test es un token en la
 * salida de un CI, y los logs de CI se archivan. Los tests e2e leen `sent` a
 * través de `app.get(MockEmailAdapter)` para poder aceptar invitaciones.
 */
export class MockEmailAdapter implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /**
   * Vacía el buzón.
   *
   * La app del e2e es una sola instancia para toda la suite, así que sin esto
   * los mensajes de un test se filtrarían al siguiente y `sent[0]` dejaría de
   * ser "el mensaje de este test".
   */
  clear(): void {
    this.sent.length = 0;
  }
}
