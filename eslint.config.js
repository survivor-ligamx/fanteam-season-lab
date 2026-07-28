export default [
  {
    ignores: [
      "legacy/**",
      ".local-data/**",
      "node_modules/**",
      "test-results/**",
      "src/players-data.js",
    ],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
    },
  },
  {
    files: ["worker/src/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
];
