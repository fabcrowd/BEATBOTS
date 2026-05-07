#!/usr/bin/env bash
cd "$(dirname "$0")"
exec node "$(dirname "$0")/imap-bridge.js"
