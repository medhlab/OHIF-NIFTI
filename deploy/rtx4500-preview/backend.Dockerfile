ARG BACKEND_BASE=ohif-nifti-rtx4500-backend:ontology-refinement-20261020
FROM ${BACKEND_BASE}
COPY monai-label/monailabel/ /code/monailabel/
RUN find /code/monailabel -name '._*' -delete && find /code/monailabel -name '__pycache__' -type d -exec rm -rf {} +
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
