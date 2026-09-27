import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import path from "path"

// pdf.js fetches these at run time, by URL, while it reads a PDF: character
// maps (Chinese/Japanese/Korean text), the 14 standard fonts a PDF may name
// without embedding, colour profiles, and the WebAssembly decoders for
// JPEG 2000 and JBIG2 images — which is what most scanners write. Without
// them those PDFs open with missing text or blank pages. A bundler cannot
// import a directory, so this serves them at /pdfjs/<dir>/<file>: straight
// from node_modules in dev, and copied into the build for nginx to serve.
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

function pdfjsAssets(): Plugin {
  const root = path.resolve(__dirname, 'node_modules/pdfjs-dist')
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const parts = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '').split('/')
        const [dir, name] = parts
        if (parts.length !== 2 || !PDFJS_ASSET_DIRS.includes(dir) || !name || name.includes('..')) return next()
        const file = path.join(root, dir, name)
        if (!fs.existsSync(file)) return next()
        if (name.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        fs.createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        for (const name of fs.readdirSync(path.join(root, dir))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(root, dir, name)) })
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // React Compiler (stable since 1.0): memoizes components and hooks at
    // build time. The chat page re-renders on every streamed frame and had
    // exactly one hand-written `memo`; the compiler does that work everywhere
    // the Rules of React allow, and skips (rather than miscompiles) anything
    // that breaks them — which `eslint-plugin-react-hooks` v7 already reports.
    // plugin-react v6 dropped its own `babel` option; this is the documented
    // replacement.
    babel({ presets: [reactCompilerPreset()] }),
    pdfjsAssets(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code the first paint always needs, in chunks of its own. In
        // one entry chunk with the app shell, every deploy renamed it, so a
        // returning visitor re-downloaded React to pick up a one-line app
        // change. Only libraries the entry imports belong here: a group for
        // something only a lazy page uses (the markdown stack) would pull it
        // forward into the first load.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'router', test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/, priority: 20 },
            { name: 'query', test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  // Unit-test config lives in vitest.config.ts, not here: tsconfig.node.json
  // typechecks this file and only this file, against vite's own `UserConfig`.
  server: {
    // The app addresses the backend with relative URLs (`/api`, `/ws`) so no
    // build-time environment file is needed — these rules are the dev-mode
    // counterpart of the /api/ and /ws/ blocks in nginx.conf.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    }
  }
})
