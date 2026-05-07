#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../target-checkout-helper/native-host" && pwd)"
MANIFEST="$ROOT/com.tch.imapbridge.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing $MANIFEST — copy com.tch.imapbridge.json.example and edit path + extension id."
  exit 1
fi
DEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DEST_DIR"
cp "$MANIFEST" "$DEST_DIR/com.tch.imapbridge.json"
echo "Installed NativeMessagingHosts manifest to $DEST_DIR/com.tch.imapbridge.json"
echo "Ensure JSON \"path\" points to run-bridge.sh (chmod +x) and allowed_origins matches your extension ID."
