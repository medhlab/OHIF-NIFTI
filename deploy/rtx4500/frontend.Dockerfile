FROM node:20.18.1-slim AS builder
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*
ENV CYPRESS_INSTALL_BINARY=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY Viewers/ ./
RUN sed -i 's#https://registry.yarnpkg.com/#https://registry.npmmirror.com/#g; s#https://registry.npmjs.org/#https://registry.npmmirror.com/#g' yarn.lock && yarn install --frozen-lockfile --registry https://registry.npmmirror.com --network-concurrency 4 --network-timeout 90000
# Preserve the project's Cornerstone, dcmjs and VTK overrides.
RUN python3 -c "from pathlib import Path; import shutil; roots=[Path('node_modules/@cornerstonejs/tools/dist/esm'),Path('node_modules/@cornerstonejs/core/dist/esm')]; files=list(Path('backup/esm').glob('*.js')); [(shutil.copy2(p,q)) for p in files for r in roots for q in r.rglob(p.name)]; shutil.copy2('backup/dcmjs/dcmjs.es.js','node_modules/dcmjs/build/dcmjs.es.js'); shutil.copy2('backup/vtkjs/ImageMarchingSquares.js','node_modules/@kitware/vtk.js/Filters/General/ImageMarchingSquares.js')"
RUN node .scripts/install-stack-labelmap-update.js && node .scripts/install-interpolation-runtime.js && yarn run verify:cornerstone-stack-labelmap-patch
ENV APP_CONFIG=config/nifti.js
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN node -e "const fs=require('fs'),p='platform/app/public/config/nifti.js';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('enableNiftiStreaming: false','enableNiftiStreaming: true').replace('enableNiftiAI: true','enableNiftiAI: false'))"
# ONNX 1.17 may load after document.currentScript becomes null on a warm reload.
# Resolve its browser script directory without referring to Node's __filename.
RUN node -e "const fs=require('fs'),p='.webpack/webpack.base.js',s=fs.readFileSync(p,'utf8'),m='const defineValues = {';if(s.split(m).length!==2)throw Error('webpack defineValues marker changed');const e='new URL(\"onnxruntime-web.js\", globalThis.location.origin + (globalThis.PUBLIC_URL || \"/\")).href';fs.writeFileSync(p,s.replace(m,m+'\n  __filename: '+JSON.stringify(e)+','))"
RUN yarn run build
FROM webapp:latest
COPY --from=builder /usr/src/app/platform/app/dist /var/www/html
