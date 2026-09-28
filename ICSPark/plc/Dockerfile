FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY plc.py .

# No root para el runtime
RUN adduser -D -H plcuser
USER plcuser

EXPOSE 502
CMD ["python", "-u", "plc.py"]
