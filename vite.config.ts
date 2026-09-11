import { defineConfig } from "vitest/config";
import { cpSync, readFileSync, writeFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    {
      name: "extension-assets",
      closeBundle() {
        cpSync("images", "dist/images", { recursive: true });
        const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
        // Only explicit local E2E builds receive permanent fixture-server access.
        if (process.env.PRMONITOR_TEST_ORIGIN) {
          const url = new URL(process.env.PRMONITOR_TEST_ORIGIN);
          if (url.hostname !== "127.0.0.1")
            throw new Error("Test origin must be loopback");
          manifest.host_permissions = [`${url.origin}/*`];
        }
        writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
      },
    },
  ],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        popup: "popup.html",
        options: "options.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.live.spec.ts"],
  },
});
