#!/bin/sh
set -eu

cp /tmp/encvoy-image-runtime-config.js /usr/share/nginx/html/config.js
chmod 0644 /usr/share/nginx/html/config.js
