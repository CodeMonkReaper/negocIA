import { beforeEach, describe, expect, it } from "vitest";
import { InvalidTokenError } from "../../../domain/errors";
import type { EmailSender } from "../../../domain/ports/email-sender";
import type { TokenHasher } from "../../../domain/ports/token-hasher";
import {
  createInMemoryScope,
  InMemoryUnitOfWork,
  makeUser,
  type InMemoryScope,
} from "../../../testing/in-memory/fakes";
import { EmailVerificationSender } from "../../auth/application/email-verification-sender";
import { EmailVerificationService } from "./email-verification.service";

const ALIVE = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2000-01-01T00:00:00.000Z");

class FakeTokenHasher implements TokenHasher {
  hashToken(token: string): string {
    return `sha256$${token}`;
  }
}

class RecordingEmailSender implements EmailSender {
  readonly messages: Parameters<EmailSender["send"]>[0][] = [];

  async send(message: Parameters<EmailSender["send"]>[0]): Promise<void> {
    this.messages.push(message);
  }
}

function buildHarness(): {
  service: EmailVerificationService;
  scope: InMemoryScope;
  emailSender: RecordingEmailSender;
  sender: EmailVerificationSender;
} {
  const scope = createInMemoryScope();
  const unitOfWork = new InMemoryUnitOfWork(scope);
  const emailSender = new RecordingEmailSender();
  const hasher = new FakeTokenHasher();

  let counter = 0;
  const opaqueTokens = { generate: () => `vt-token-${(counter += 1)}` };

  const sender = new EmailVerificationSender(
    unitOfWork,
    opaqueTokens,
    hasher,
    emailSender,
  );

  const service = new EmailVerificationService(unitOfWork, hasher, sender);

  return { service, scope, emailSender, sender };
}

function pendingUser(scope: InMemoryScope): void {
  scope.users.rows.push(
    makeUser({ id: "user-1", email: "ana@example.com", emailVerifiedAt: null }),
  );
}

describe("EmailVerificationService.verify", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    pendingUser(harness.scope);
  });

  it("consume el token y marca emailVerifiedAt", async () => {
    await harness.sender.send(
      { id: "user-1", email: "ana@example.com", name: "Ana", emailVerifiedAt: null },
      "Acme",
    );
    const token = harness.emailSender.messages[0]?.token as string;

    const result = await harness.service.verify(token);

    expect(result.emailVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.scope.users.rows[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(harness.scope.verificationTokens.rows[0]?.usedAt).toBeInstanceOf(Date);
  });

  it("persiste solo el hash del token", async () => {
    await harness.sender.send(
      { id: "user-1", email: "ana@example.com", name: "Ana", emailVerifiedAt: null },
      "Acme",
    );
    const token = harness.emailSender.messages[0]?.token as string;
    await harness.service.verify(token);

    expect(harness.scope.verificationTokens.rows[0]?.tokenHash).toBe(`sha256$${token}`);
  });

  it("es de un solo uso", async () => {
    await harness.sender.send(
      { id: "user-1", email: "ana@example.com", name: "Ana", emailVerifiedAt: null },
      "Acme",
    );
    const token = harness.emailSender.messages[0]?.token as string;
    await harness.service.verify(token);

    await expect(harness.service.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rechaza un token inexistente", async () => {
    await expect(harness.service.verify("nada")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rechaza un token vencido y lo deja consumido de todos modos", async () => {
    await harness.sender.send(
      { id: "user-1", email: "ana@example.com", name: "Ana", emailVerifiedAt: null },
      "Acme",
    );
    harness.scope.verificationTokens.rows[0]!.expiresAt = PAST;

    const token = harness.emailSender.messages[0]?.token as string;
    await expect(harness.service.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);

    // Este es el punto del test: el consumo tiene que **sobrevivir** al error.
    // Lanzar el `InvalidTokenError` dentro de la transacción lo habría deshecho
    // por rollback y el token vencido habría seguido vivo.
    expect(harness.scope.verificationTokens.rows[0]?.usedAt).toBeInstanceOf(Date);
    expect(harness.scope.users.rows[0]?.emailVerifiedAt).toBeNull();
  });
});

describe("EmailVerificationService.resend", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    pendingUser(harness.scope);
  });

  const recipient = {
    id: "user-1",
    email: "ana@example.com",
    name: "Ana",
    emailVerifiedAt: null,
  };

  it("emite un token nuevo y deja el anterior invalidado", async () => {
    const first = await harness.sender.send(recipient, "Acme");
    expect(first.sent).toBe(true);
    const firstToken = harness.emailSender.messages[0]?.token as string;

    const result = await harness.service.resend(recipient, "Acme");

    expect(result.sent).toBe(true);
    const secondToken = harness.emailSender.messages[1]?.token as string;
    expect(secondToken).not.toBe(firstToken);

    // El anterior queda `used`: los dos emails no pueden ser válidos a la vez.
    const rows = harness.scope.verificationTokens.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usedAt).toBeInstanceOf(Date);
    expect(rows[1]?.usedAt).toBeNull();
    expect(rows[1]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Y el viejo ya no verifica nada.
    await expect(harness.service.verify(firstToken)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("no hace nada si el email ya está verificado", async () => {
    const verified = { ...recipient, emailVerifiedAt: ALIVE };

    const result = await harness.service.resend(verified, "Acme");

    expect(result.sent).toBe(false);
    expect(harness.emailSender.messages).toHaveLength(0);
    expect(harness.scope.verificationTokens.rows).toHaveLength(0);
  });

  it("permite reenviar aunque el envío anterior fallara", async () => {
    // El token quedó en la base sin email: el reenvío es la vía de recuperación
    // y no debe depender de que exista un mensaje entregado.
    await harness.sender.send(recipient, "Acme");

    const result = await harness.service.resend(recipient, "Acme");

    expect(result.sent).toBe(true);
    expect(harness.scope.verificationTokens.rows).toHaveLength(2);
  });
});
