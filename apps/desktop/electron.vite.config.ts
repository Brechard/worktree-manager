import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/main/index.ts'),
        formats: ['es'],
        fileName: () => '[name].js',
      },
      rollupOptions: {
        output: {
          dir: resolve('dist-electron/main'),
        },
      },
    },
    resolve: {
      alias: {
        '@worktree/contracts': resolve('../../packages/contracts/dist/index.js'),
        '@worktree/shared': resolve('../../packages/shared/dist/index.js'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/preload/index.ts'),
        formats: ['es'],
        fileName: () => '[name].js',
      },
      rollupOptions: {
        output: {
          dir: resolve('dist-electron/preload'),
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      outDir: resolve('dist-electron/renderer'),
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@worktree/contracts': resolve('../../packages/contracts/dist/index.js'),
      },
    },
  },
})
