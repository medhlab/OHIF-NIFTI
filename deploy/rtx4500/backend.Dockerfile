FROM monai:latest
COPY monai-label/monailabel/ /code/monailabel/
COPY monai-label/sample-apps/radiology/main.py /code/apps/radiology/main.py
COPY monai-label/sample-apps/radiology/lib/ /code/apps/radiology/lib/
