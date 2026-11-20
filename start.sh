#!/bin/sh
# Starts Cryptika GRC Hub on http://localhost:4000 (Node.js 22.13 or newer).
cd "$(dirname "$0")" && exec node --no-warnings server/index.js
