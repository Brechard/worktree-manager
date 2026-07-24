import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // Bundle the workspace packages (and their only runtime dep, zod) into the
    // main bundle — they aren't shipped as node_modules in the packaged app, so
    // externalizing them makes the installed app crash on launch.
    plugins: [
      externalizeDepsPlugin({ exclude: ['@worktree/shared', '@worktree/contracts', 'zod'] }),
    ],
    build: {
      // Build the main process as CommonJS. Electron's ESM loader chokes on an
      // ESM main that does `import ... from 'electron'` (Node's ESM→CJS interop
      // throws "Cannot read properties of undefined (reading 'exports')"), so the
      // packaged app never launches. CJS avoids that entirely.
      lib: {
        entry: resolve('src/main/index.ts'),
        formats: ['cjs'],
        fileName: () => '[name].cjs',
      },
      rollupOptions: {
        output: {
          dir: resolve('dist-electron/main'),
          format: 'cjs',
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
