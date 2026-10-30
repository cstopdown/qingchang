FROM python:3.12-slim
WORKDIR /app
COPY gateway/requirements.txt /app/gateway/requirements.txt
RUN pip install --no-cache-dir -r gateway/requirements.txt
COPY gateway/app.py /app/gateway/app.py
COPY dist /app/dist
CMD ["python", "gateway/app.py"]
