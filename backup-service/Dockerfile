FROM postgres:15-alpine

# Install: gnupg (encryption), aws-cli (R2 S3-compatible upload), curl (heartbeat)
RUN apk add --no-cache gnupg aws-cli curl bash

WORKDIR /app
COPY backup.sh /app/backup.sh
RUN chmod +x /app/backup.sh

# Railway cron runs this on schedule; no long-running process needed
CMD ["/app/backup.sh"]
