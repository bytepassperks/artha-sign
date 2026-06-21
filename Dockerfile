# Artha Sign — Scalingo deploy image.
# Thin overlay on the official Documenso release image so Scalingo's native
# Docker builder reproduces the upstream binary exactly, then bakes a
# self-signed signing certificate so document signing works out of the box.
FROM documenso/documenso:latest

USER root
RUN apk add --no-cache openssl \
 && mkdir -p /opt/documenso \
 && openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout /tmp/sign-key.pem -out /tmp/sign-cert.pem -days 3650 \
      -subj "/CN=Artha Sign/O=Artha" \
 && openssl pkcs12 -export -out /opt/documenso/cert.p12 \
      -inkey /tmp/sign-key.pem -in /tmp/sign-cert.pem -passout pass: \
 && rm -f /tmp/sign-key.pem /tmp/sign-cert.pem \
 && chown -R nodejs:nodejs /opt/documenso \
 && chmod 600 /opt/documenso/cert.p12
USER nodejs
