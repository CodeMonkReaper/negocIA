import base from "./base.js";

export default [
  ...base,
  {
    rules: {
      // NestJS + DI usan los imports como valores (emitDecoratorMetadata).
      // Exigir imports de solo tipo rompería la inyección de dependencias.
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
];