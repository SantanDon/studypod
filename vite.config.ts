import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { corsProxyPlugin } from "./vite-plugin-cors-proxy";

// https://vitejs.de
// v/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    // Cross-Origin Isolation headers for SharedArrayBuffer (required for Web Workers with ONNX)
    // Using 'credentialless' instead of 'require-corp' to allow loading external resources (ONNX models)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  plugins: [
    react(),
    corsProxyPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
    optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-tooltip'],
          'vendor-ai': ['groq-sdk', '@xenova/transformers'],
          'vendor-tts': ['kokoro-js'],
          'vendor-pdf': ['pdfjs-dist', 'pdf-parse'],
        },
      },
    },
  }
}));

