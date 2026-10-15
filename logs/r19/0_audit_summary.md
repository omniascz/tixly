metadata.vulnerabilities: {"info":0,"low":1,"moderate":27,"high":23,"critical":2,"total":53}

| balíček | závažnost | přímý | rozsah | fixAvailable |
|---|---|---|---|---|
| @opentelemetry/core | moderate | false | <2.8.0 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-amqplib | moderate | false | <=0.46.1 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-connect | moderate | false | <=0.43.1 | true |
| @opentelemetry/instrumentation-express | moderate | false | <=0.47.1 | true |
| @opentelemetry/instrumentation-fastify | moderate | false | <=0.44.2 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-fs | moderate | false | <=0.19.1 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-hapi | moderate | false | 0.24.0 - 0.45.2 | true |
| @opentelemetry/instrumentation-http | moderate | false | <=0.16.0 || 0.19.1-alpha.7 - 0.218.0 | true |
| @opentelemetry/instrumentation-knex | moderate | false | <0.65.0 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-koa | moderate | false | <=0.15.0 || 0.20.0 - 0.47.1 | true |
| @opentelemetry/instrumentation-mongoose | moderate | false | <=0.66.0 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/instrumentation-mysql | moderate | false | <0.67.0 | true |
| @opentelemetry/instrumentation-mysql2 | moderate | false | <=0.66.0 | true |
| @opentelemetry/instrumentation-pg | moderate | false | <=0.72.0 | true |
| @opentelemetry/instrumentation-tedious | moderate | false | <0.40.0 | true |
| @opentelemetry/instrumentation-undici | moderate | false | <=0.10.1 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/resources | moderate | false | 0.8.0 - 2.7.1 | true |
| @opentelemetry/sdk-trace-base | moderate | false | <=2.7.1 | @sentry/nextjs@11.7.0 (major) |
| @opentelemetry/sql-common | moderate | false | <=0.40.1 | true |
| @sentry/bundler-plugin-core | high | false | <=4.9.1 | true |
| @sentry/nextjs | high | true | 8.0.0-alpha.2 - 10.39.0 | @sentry/nextjs@11.7.0 (major) |
| @sentry/node | moderate | false | 8.0.0-alpha.1 - 10.53.1 | @sentry/nextjs@11.7.0 (major) |
| @sentry/webpack-plugin | high | false | 2.0.0-alpha.1 - 5.1.1 | @sentry/nextjs@11.7.0 (major) |
| rollup | high | false | 3.0.0 - 3.29.5 | @sentry/nextjs@11.7.0 (major) |
| unplugin | high | false | 0.4.0 - 1.12.2 | @sentry/nextjs@11.7.0 (major) |

Všechny high/critical:
- @next/eslint-plugin-next high via=fast-glob 
- @sentry/bundler-plugin-core high via=unplugin 
- @sentry/nextjs high via=@sentry/node,@sentry/webpack-plugin,rollup 
- @sentry/webpack-plugin high via=@sentry/bundler-plugin-core,unplugin,uuid 
- @typescript-eslint/eslint-plugin high via=@typescript-eslint/type-utils,@typescript-eslint/utils 
- @typescript-eslint/parser high via=@typescript-eslint/typescript-estree 
- @typescript-eslint/type-utils high via=@typescript-eslint/typescript-estree,@typescript-eslint/utils 
- @typescript-eslint/typescript-estree high via=globby,minimatch 
- @typescript-eslint/utils high via=@typescript-eslint/typescript-estree 
- @vitest/ui high via=fast-glob 
- braces high via=1240992 https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- eslint-config-next high via=@next/eslint-plugin-next 
- fast-glob high via=micromatch 
- globby high via=fast-glob 
- chokidar high via=braces 
- micromatch high via=braces 
- minimatch high via=1113465,1113544,1113552 https://github.com/advisories/GHSA-3ppc-4f35-3m26 https://github.com/advisories/GHSA-7r86-cg39-jmmj https://github.com/advisories/GHSA-23c5-xmqv-rm74
- node-forge high via=1240912 https://github.com/advisories/GHSA-86w9-cpqp-85rv
- postcss high via=1117015,1124252,1130709,1139510 https://github.com/advisories/GHSA-qx2v-qp2m-jg93 https://github.com/advisories/GHSA-6g55-p6wh-862q https://github.com/advisories/GHSA-fxqj-rqcc-2cmp https://github.com/advisories/GHSA-r28c-9q8g-f849
- rollup high via=1113516 https://github.com/advisories/GHSA-mw96-cpmx-2vgc
- tailwindcss high via=chokidar,fast-glob,micromatch,postcss-nested,postcss-selector-parser 
- tinypool critical via=1241260,1241261 https://github.com/advisories/GHSA-5gmw-xhrv-c9v3 https://github.com/advisories/GHSA-85c8-ppgw-ccpr
- unplugin high via=chokidar 
- vite high via=1116229,1120784,1123525,esbuild https://github.com/advisories/GHSA-4w7w-66w2-5vf9 https://github.com/advisories/GHSA-v6wh-96g9-6wx3 https://github.com/advisories/GHSA-fx2h-pf6j-xcff
- vitest critical via=1139528,tinypool,vite,vite-node https://github.com/advisories/GHSA-5xrq-8626-4rwp
