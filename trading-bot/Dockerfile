FROM python:3.12-slim
WORKDIR /app
COPY . .
# OANDA_TOKEN and OANDA_ACCOUNT_ID come from the server's environment, never baked in
ENV PYTHONUNBUFFERED=1
CMD ["python", "run.py", "practice"]
