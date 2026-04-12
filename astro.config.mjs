// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://studionin.com',
  i18n: {
    defaultLocale: 'ko',
    locales: ['ko', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  image: {
    domains: [],
  },
});
