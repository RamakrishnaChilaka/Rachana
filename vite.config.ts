import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function resolveExcalidrawFontUrls(): Plugin {
  return {
    name: 'resolve-excalidraw-font-urls',
    enforce: 'pre',
    transform(source, id) {
      if (
        !id.includes('@excalidraw/excalidraw/dist/') ||
        !id.includes('/index.css') ||
        !source.includes('./fonts/Assistant/')
      ) {
        return null
      }

      return source.replaceAll(
        'url("./fonts/Assistant/',
        'url("/assets/fonts/Assistant/',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    resolveExcalidrawFontUrls(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*.woff2",
          dest: "assets/excalidraw/fonts",
          rename: { stripBase: 6 },
        },
      ],
    }),
    react(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Test configuration for Vitest
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
}));
