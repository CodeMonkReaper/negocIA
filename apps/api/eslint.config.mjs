import nestjs from "@negocia/eslint-config/nestjs.js";

export default [
  ...nestjs,
  {
    ignores: ["dist/"],
  },
];