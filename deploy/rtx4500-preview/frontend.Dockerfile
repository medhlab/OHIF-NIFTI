FROM ohif-prompt-test-builder:20261013 AS builder
WORKDIR /usr/src/app
COPY Viewers/ ./
RUN node .scripts/install-stack-labelmap-update.js && node .scripts/install-interpolation-runtime.js && yarn run verify:cornerstone-stack-labelmap-patch
ENV APP_CONFIG=config/nifti.js
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN node -e "const fs=require('fs'),p='platform/app/public/config/nifti.js';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('enableNiftiStreaming: false','enableNiftiStreaming: true'))"
RUN node -e "const fs=require('fs'),p='.webpack/webpack.base.js',s=fs.readFileSync(p,'utf8'),m='const defineValues = {';if(s.split(m).length!==2)throw Error('webpack defineValues marker changed');const e='new URL(\"onnxruntime-web.js\", globalThis.location.origin + (globalThis.PUBLIC_URL || \"/\")).href';fs.writeFileSync(p,s.replace(m,m+'\n  __filename: '+JSON.stringify(e)+','))"
RUN node --test extensions/nifti/src/entityLabels.test.mjs extensions/nifti/src/frameQueue.test.mjs && yarn jest --config extensions/nifti/jest.config.js --runInBand --runTestsByPath extensions/nifti/src/streaming.test.js extensions/nifti/src/annotationTarget.test.js extensions/nifti/src/entityMaskEmpty.test.js
RUN node --test extensions/nifti/src/editingState.test.mjs extensions/nifti/src/maskTransport.test.mjs && yarn jest --config extensions/default/jest.config.js --runInBand --runTestsByPath extensions/default/src/utils/nnInteractiveEdit.test.js extensions/default/src/utils/nnInteractiveController.test.js
RUN node --test extensions/nifti/src/stackScrollGuard.test.mjs extensions/nifti/src/niftiViewportGuard.test.mjs extensions/nifti/src/sliceLoadingState.test.mjs extensions/nifti/src/prefetchPool.test.mjs
RUN yarn jest --config extensions/nifti/jest.config.js --runInBand --runTestsByPath extensions/nifti/src/findingLocation.test.js extensions/nifti/src/packedMasks.test.js extensions/nifti/src/frameDiskCache.test.js extensions/nifti/src/casePrefetch.test.js extensions/nifti/src/editingLocks.test.js extensions/nifti/src/imagePosition.test.js
RUN node --test extensions/nifti/src/caseOrder.test.mjs
RUN node --test extensions/nifti/src/legacyMaskAccess.test.mjs && yarn jest --config extensions/nifti/jest.config.js --runInBand --runTestsByPath extensions/nifti/src/saveChanges.test.js extensions/nifti/src/historyPreviewModel.test.js extensions/nifti/src/masksRecovery.test.js extensions/nifti/src/presentation.test.js extensions/nifti/src/switchCase.test.js extensions/nifti/src/workspace.test.js
RUN yarn run build
FROM webapp:latest
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
COPY --from=builder /usr/src/app/platform/app/dist /var/www/html
