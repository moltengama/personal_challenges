FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY safety.py .

RUN adduser -D -H sisuser
USER sisuser

EXPOSE 502
CMD ["python", "-u", "safety.py"]
