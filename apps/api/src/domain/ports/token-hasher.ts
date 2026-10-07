export interface TokenHasher {
  hashToken(plain: string): string;
}