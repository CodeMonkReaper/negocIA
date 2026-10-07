import base from "@negocia/eslint-config/base.js";

export default [
  ...base,
  {
    ignores: ["dist/", "src/generated/"],
  },
];