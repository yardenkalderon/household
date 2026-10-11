import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/household/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
      manifest: {
        name: 'הבית שלנו',
        short_name: 'הבית',
        description: 'מטלות, חשבונות ורשימת קניות של הבית',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        start_url: '/household/',
        scope: '/household/',
        theme_color: '#0F6E56',
        background_color: '#F6F5F1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
