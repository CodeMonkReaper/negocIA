import { createHash } from "node:crypto";
import type { TokenHasher } from "../domain/ports";

export class Sha256TokenHasher implements TokenHasher {
  hashToken(plain: string): string {
    return createHash("sha256").update(plain).digest("hex");
  }
}