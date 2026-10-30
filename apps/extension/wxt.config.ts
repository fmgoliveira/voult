import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Voult',
    description: 'Self-hosted, zero-knowledge password manager',
    permissions: ['storage'],
    browser_specific_settings: {
      gecko: {
        id: 'voult@franciscoliveira.com',
        data_collection_permissions: { required: ['none'] },
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
