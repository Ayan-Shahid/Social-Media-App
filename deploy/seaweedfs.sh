#!/bin/sh
# Starts SeaweedFS (master + volume + filer + S3 gateway in one process) with Glimpse's access rules.
#   glimpse    full access to both buckets (the API and worker), credentials from .env
#   anonymous  read-only, and only the "media" bucket (processed, public files)
# The private "uploads" bucket has no anonymous access: originals can't be read without credentials.
set -eu
cat > /tmp/s3.json <<JSON
{
  "identities": [
    { "name": "glimpse", "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"] },
    { "name": "anonymous", "actions": ["Read:media"] }
  ]
}
JSON
exec weed server -dir=/data -ip.bind=0.0.0.0 -volume.max=0 -master.volumeSizeLimitMB=512 \
  -s3 -s3.port=8333 -s3.config=/tmp/s3.json
