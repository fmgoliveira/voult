import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'Voult',
    description: 'Self-hosted, zero-knowledge password manager',
    permissions: ['storage', 'alarms', 'idle', ...(browser === 'chrome' ? ['offscreen'] : [])],
    // Allow talking to any self-hosted server the user configures.
    host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    browser_specific_settings: {
      gecko: {
        id: 'voult@franciscoliveira.com',
        data_collection_permissions: { required: ['none'] },
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  }),
});
