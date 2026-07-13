import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import type { Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

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
        'url("/assets/fonts/Assistant/'
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    build: {
      rollupOptions: {
        input: { index: `${root}/electron/main.ts` },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: `${root}/electron/preload.ts` },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root,
    plugins: [
      resolveExcalidrawFontUrls(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*.woff2',
            dest: 'assets/excalidraw/fonts',
            rename: { stripBase: 6 },
          },
        ],
      }),
      react(),
    ],
    build: {
      rollupOptions: {
        input: { index: `${root}/index.html` },
      },
    },
  },
})