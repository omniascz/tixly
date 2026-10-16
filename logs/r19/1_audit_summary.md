metadata.vulnerabilities: {"info":0,"low":1,"moderate":5,"high":18,"critical":2,"total":26}

| balíček | závažnost | přímý | rozsah | fixAvailable |
|---|---|---|---|---|

Všechny high/critical:
- @next/eslint-plugin-next high via=fast-glob 
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
- tailwindcss high via=chokidar,fast-glob,micromatch,postcss-nested,postcss-selector-parser 
- tinypool critical via=1241260,1241261 https://github.com/advisories/GHSA-5gmw-xhrv-c9v3 https://github.com/advisories/GHSA-85c8-ppgw-ccpr
- vite high via=1116229,1120784,1123525,esbuild https://github.com/advisories/GHSA-4w7w-66w2-5vf9 https://github.com/advisories/GHSA-v6wh-96g9-6wx3 https://github.com/advisories/GHSA-fx2h-pf6j-xcff
- vitest critical via=1139528,tinypool,vite,vite-node https://github.com/advisories/GHSA-5xrq-8626-4rwp
