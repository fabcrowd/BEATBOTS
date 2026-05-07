# IMAP native messaging host (Walmart 2FA)

This folder provides an optional **Chrome native messaging host** so the extension can read **6-digit verification codes** from your email via IMAP.

## Important: every checkout of the repo, every machine

Native messaging is **not** part of the extension bundle. Chrome launches a **local** helper via an OS-specific manifest whose **`path` points at files on disk**. That means:

| Situation | What you must do |
|-----------|------------------|
| **Clone or copy this repo to another folder** | Recreate `com.tch.imapbridge.json` (or edit **`path`**) so it matches the **new absolute path** to `run-bridge.cmd` / `run-bridge.sh`. Re-run the installer step below so Chrome picks up the manifest. |
| **Use another computer or VM** | Run the full setup on **that** machine: Node.js, `npm install` in `native-host/`, JSON + **`allowed_origins`**, register the host. Nothing in git replaces this. |
| **Reload unpacked extension or new Chrome profile** | **Extension ID** changes when the unpacked path changes. Update **`allowed_origins`** in `com.tch.imapbridge.json` to `chrome-extension://<id>/` from `chrome://extensions` (Developer mode → ID under the extension name). |
| **Microsoft Edge** (Chromium) | Same idea; registry/key paths differ. Put the same JSON under Edge’s NativeMessagingHosts folder for your OS (search “Edge NativeMessagingHosts”). |

Keep **`com.tch.imapbridge.json` out of version control** if it embeds machine-specific paths—only the `.example` file ships in the repo.

## Setup

1. Install [Node.js](https://nodejs.org/) (LTS).
2. In **this** directory (`target-checkout-helper/native-host/`) run:
   ```bash
   npm install
   ```
3. Copy `com.tch.imapbridge.json.example` to `com.tch.imapbridge.json`.
4. Edit `com.tch.imapbridge.json`:
   - **`path`**: absolute path to `run-bridge.cmd` (Windows) or `run-bridge.sh` (macOS/Linux).
   - **`allowed_origins`**: set to `chrome-extension://YOUR_EXTENSION_ID/` (find ID under `chrome://extensions` → Developer mode).
5. Register the manifest with Chrome:
   - **Windows**: run `installer/install-native-host.bat` from the repo root (after placing `com.tch.imapbridge.json` in `native-host/`).
   - **macOS**: run `installer/install-native-host.sh` or copy the JSON into  
     `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.
   - **Linux**: copy the JSON into  
     `~/.config/google-chrome/NativeMessagingHosts/`.

## Test

From the extension popup → **Accounts** → **Test native host**.  
If Chrome reports “Specified native messaging host not found”, the registry/path/origins are wrong.

## Security

IMAP credentials are stored in **Chrome local storage** like other popup fields. Use an **app-specific password** where supported.
