// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
    // Ensure server-side rendering for all routes
    output: 'server',

    adapter: cloudflare({
        platformProxy: {
            enabled: true,
        },
    }),

    vite: {
        plugins: [tailwindcss()],
    },

    integrations: [preact()],
});
