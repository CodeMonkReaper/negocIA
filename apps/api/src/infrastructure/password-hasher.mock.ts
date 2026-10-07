import type { PasswordHasher } from "../domain/ports";

export class MockPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `mock:${plain}`;
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `mock:${plain}`;
  }
}