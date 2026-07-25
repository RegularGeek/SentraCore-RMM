// Flat config (ESLint 9). Two environments live in this package: CommonJS
// Node code for the server, and browser scripts under public/.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "public/ui/styles/tailwind.build.css"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, SC: "writable" },
    },
    rules: {
      // The dashboard is a single script-tag bundle: functions are hoisted
      // and referenced across sections, and SC is set up by the design system.
      "no-unused-vars": ["error", { varsIgnorePattern: "^(boot|SC)$" }],
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
