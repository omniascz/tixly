npm audit po upgradu: {"info":0,"low":1,"moderate":28,"high":26,"critical":2,"total":57}

| balíček | závažnost | přímá/tranzitivní | potřebná verze (oprava podle npm) | dopad |
|---|---|---|---|---|
| tinypool | critical | tranzitivní | vitest@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| vitest | critical | přímá | vitest@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @fastify/busboy | high | tranzitivní | @vercel/blob@2.8.1 (major) | runtime: klient @vercel/blob (nahrávání souborů) |
| @next/eslint-plugin-next | high | tranzitivní | eslint-config-next@14.2.35 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @sentry/bundler-plugin-core | high | tranzitivní | npm audit fix (bez major) | jen build (nahrávání source map do Sentry) |
| @sentry/nextjs | high | přímá | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @sentry/webpack-plugin | high | tranzitivní | @sentry/nextjs@11.5.0 (major) | jen build (nahrávání source map do Sentry) |
| @typescript-eslint/eslint-plugin | high | přímá | @typescript-eslint/eslint-plugin@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @typescript-eslint/parser | high | přímá | @typescript-eslint/parser@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @typescript-eslint/type-utils | high | tranzitivní | npm audit fix (bez major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @typescript-eslint/typescript-estree | high | tranzitivní | @typescript-eslint/parser@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @typescript-eslint/utils | high | tranzitivní | @typescript-eslint/eslint-plugin@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @vitest/ui | high | přímá | @vitest/ui@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| braces | high | tranzitivní | tailwindcss@4.3.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| eslint-config-next | high | přímá | eslint-config-next@14.2.35 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| fast-glob | high | tranzitivní | @vitest/ui@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| globby | high | tranzitivní | @typescript-eslint/parser@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| chokidar | high | tranzitivní | tailwindcss@4.3.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| micromatch | high | tranzitivní | tailwindcss@4.3.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| minimatch | high | tranzitivní | @typescript-eslint/parser@8.71.1 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| node-forge | high | přímá | oprava neexistuje | runtime: kryptografie (oprava zatím neexistuje) |
| nodemailer | high | přímá | nodemailer@10.0.16 (major) | runtime: odesílání e-mailů (SMTP) |
| postcss | high | přímá | next@16.4.0 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| rollup | high | tranzitivní | @sentry/nextjs@11.5.0 (major) | jen build (nahrávání source map do Sentry) |
| tailwindcss | high | přímá | tailwindcss@4.3.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| undici | high | tranzitivní | @vercel/blob@2.8.1 (major) | runtime: klient @vercel/blob (nahrávání souborů) |
| unplugin | high | tranzitivní | @sentry/nextjs@11.5.0 (major) | jen build (nahrávání source map do Sentry) |
| vite | high | tranzitivní | vitest@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @opentelemetry/core | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-amqplib | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-connect | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-express | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-fastify | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-fs | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-hapi | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-http | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-knex | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-koa | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-mongoose | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-mysql | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-mysql2 | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-pg | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-tedious | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/instrumentation-undici | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/resources | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/sdk-trace-base | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @opentelemetry/sql-common | moderate | tranzitivní | npm audit fix (bez major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @prisma/instrumentation | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @sentry/node | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| @vercel/blob | moderate | přímá | @vercel/blob@2.8.1 (major) | runtime: klient @vercel/blob (nahrávání souborů) |
| esbuild | moderate | tranzitivní | vitest@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| next | moderate | přímá | next@16.4.0 (major) | build: zabudovaný postcss 8.4.31 zpracovává jen vlastní CSS aplikace při buildu; za běhu nepoužit |
| postcss-nested | moderate | tranzitivní | npm audit fix (bez major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| postcss-selector-parser | moderate | tranzitivní | tailwindcss@4.3.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| uuid | moderate | tranzitivní | @sentry/nextjs@11.5.0 (major) | runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní |
| vite-node | moderate | tranzitivní | vitest@5.0.3 (major) | jen vývoj / testy / build CSS — nejde do produkčního běhu |
| @simplewebauthn/server | low | přímá | @simplewebauthn/server@14.0.3 (major) | runtime: přihlášení passkey |
