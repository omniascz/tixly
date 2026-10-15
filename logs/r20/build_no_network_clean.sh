#!/usr/bin/env bash
# Kolo 20 — build bez sítě (CI job „Build bez sítě") v ČISTÉM klonu HEAD větve: npm ci, pak scripts/ci/build-no-network.sh.
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r20; C=/c/Users/omnia/AppData/Local/Temp/r20-clean
H=$(git -C $T rev-parse HEAD)
rm -rf $C && git clone -q --no-hardlinks $T $C && git -C $C checkout -q $H && echo "klon $C @ $H"
cd $C/nextjs-boilerplate && npm ci --no-audit --no-fund > $R/9_nonet_npm_ci.txt 2>&1; echo "npm ci exit $?"
{ bash scripts/ci/build-no-network.sh; echo "exit=$?"; } > $R/9_build_no_network.console.txt 2>&1
tail -2 $R/9_build_no_network.console.txt
echo NONET_DONE
