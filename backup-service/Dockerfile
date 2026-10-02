FROM postgres:15-alpine

# Restore-drill image: same base as backup-service, runs the drill once.
RUN apk add --no-cache gnupg aws-cli curl bash

WORKDIR /app
COPY restore-drill.sh /app/restore-drill.sh
RUN chmod +x /app/restore-drill.sh

CMD ["/app/restore-drill.sh"]
