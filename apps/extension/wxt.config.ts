import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'Voult',
    description: 'Self-hosted, zero-knowledge password manager',
    permissions: [
      'storage',
      'alarms',
      'idle',
      'contextMenus',
      'activeTab',
      ...(browser === 'chrome' ? ['offscreen'] : []),
    ],
    // Allow talking to any self-hosted server the user configures.
    commands: {
      'fill-login': {
        suggested_key: { default: 'Ctrl+Shift+L', mac: 'Command+Shift+L' },
        description: 'Fill login on this page',
      },
    },
    // The passkey prompt is shown over the page in an iframe, so pages must be able to embed it.
    web_accessible_resources: [
      {
        resources: ['prompt.html', 'unlock.html', 'chunks/*', 'assets/*'],
        matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
      },
    ],
    host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    browser_specific_settings: {
      gecko: {
        id: 'voult@franciscoliveira.com',
        // Self-hosted updates for the AMO-unlisted build: Firefox polls this JSON (the release
        // workflow publishes it next to the signed .xpi).
        update_url: 'https://github.com/fmgoliveira/voult/releases/latest/download/updates.json',
        data_collection_permissions: { required: ['none'] },
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  }),
});
