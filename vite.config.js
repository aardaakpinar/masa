import { defineConfig } from 'vite'
import { resolve } from 'path'

const isGithubActions = process.env.GITHUB_ACTIONS === 'true'

export default defineConfig({
  root: 'src',
  base: isGithubActions ? '/masa/' : '',
  server: {
    port: 5173,
    open: true
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    minify: 'terser',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html')
      }
    }
  }
})
