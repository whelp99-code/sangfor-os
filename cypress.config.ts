import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL ?? "http://localhost:3101",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: false,
  },
  video: false,
  screenshotOnRunFailure: true,
});
