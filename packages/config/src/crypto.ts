import { createCipheriv, createDecipheriv, randomBytes, type CipherGCMTypes } from "node:crypto";

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class CryptoService {
  private readonly key: Buffer;

  constructor(keyB64: string) {
    const key = Buffer.from(keyB64, "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error(`ENCRYPTION_KEY debe ser ${KEY_LENGTH} bytes (base64), recibió ${key.length}`);
    }
    this.key = key;
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    const tag = Buffer.from(payload.tag, "base64");

    if (iv.length !== IV_LENGTH) {
      throw new Error(`IV inválido: ${iv.length} bytes, esperado ${IV_LENGTH}`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new Error(`Tag inválido: ${tag.length} bytes, esperado ${TAG_LENGTH}`);
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}