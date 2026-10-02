FROM postgres:17-alpine
RUN apk add --no-cache gnupg aws-cli curl bash
WORKDIR /app
COPY restore-drill.sh /app/restore-drill.sh
RUN chmod +x /app/restore-drill.sh
CMD ["/app/restore-drill.sh"]
