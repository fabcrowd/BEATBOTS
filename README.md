# Target + Walmart Checkout Helper

Chrome extension (Manifest V3) that automates the checkout flow on **Target.com** and **Walmart.com** — Add to Cart through Order Review. You place the final order.

---

## Installation

### Windows (easiest)

1. Click the green **Code → Download ZIP** button on this page and extract it
2. In the extracted folder, double-click **`target-checkout-helper-installer.exe`**
3. Chrome opens to `chrome://extensions`
4. Turn on **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the `target-checkout-helper/` folder

No terminal or admin access required.

### macOS / Linux

```bash
chmod +x install.sh
./install.sh
```

Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `target-checkout-helper/`.

### Windows (script fallback, no .exe)

Double-click `install.bat` from the repo root.

---

## First-time setup

1. Click the extension icon in the Chrome toolbar
2. Fill in your **Shipping** and **Payment** details under the **Shipping & pay** tab
3. Click **Save settings**
4. Add product URLs in the **Monitor** (Target) or **Walmart** tab
5. Set your drop time and click **Start monitoring**

---

## Walmart IMAP 2FA (optional — auto-fills verification codes)

When Walmart sends a 6-digit sign-in code to your email, the extension can read and submit it automatically using a small local Node.js helper.

### Requirements

- [Node.js LTS](https://nodejs.org/) installed on your machine
- A Gmail **App Password** (or equivalent for other providers) — your regular password won't work

### Gmail App Password

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (2-Step Verification must be enabled)
2. Name it anything → **Create**
3. Copy the 16-character password

### Setup steps

**1. Install dependencies**

```bash
cd target-checkout-helper/native-host
npm install
```

**2. Create the native host manifest**

Copy the example file and edit it:

```bash
cp target-checkout-helper/native-host/com.tch.imapbridge.json.example \
   target-checkout-helper/native-host/com.tch.imapbridge.json
```

Edit `com.tch.imapbridge.json`:
- Set `path` to the absolute path of `run-bridge.cmd` (Windows) or `run-bridge.sh` (macOS/Linux)
- Set `allowed_origins` to your extension ID from `chrome://extensions` (Developer mode → ID under the extension name)

Example (Windows):
```json
{
  "name": "com.tch.imapbridge",
  "description": "TCH IMAP bridge for Walmart 2FA codes",
  "path": "C:\\Users\\YourName\\Desktop\\BEATBOTS\\target-checkout-helper\\native-host\\run-bridge.cmd",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID_HERE/"
  ]
}
```

**3. Register with Chrome**

- **Windows:** run `installer\install-native-host.bat` from the repo root
- **macOS/Linux:** run `installer/install-native-host.sh` from the repo root

**4. Configure in the popup**

Open the extension popup → **Accounts** tab:

| Field | Value |
|-------|-------|
| IMAP host | `imap.gmail.com` (Gmail) or `outlook.office365.com` (Outlook) |
| Port | `993` |
| IMAP username | Your full email address |
| IMAP password | The App Password from above |

Check **Enable IMAP auto-read for Walmart 2FA** → **Save settings** → **Test native host**.

> The native host must be set up separately on each machine. The extension ID changes if you reload unpacked from a different folder — update `allowed_origins` if that happens.

---

## Multiple accounts

Run each Walmart account in its own **Chrome profile** (separate cookies, session, fingerprint). Each profile loads its own extension instance with independent popup settings. Use a different **Address jig index** per profile (Shipping & pay tab) to vary the shipping address and reduce cancellation risk.

---

## Notes

- The extension stops at **Order Review** — it does not click Place Order unless you enable **Auto place order** (off by default)
- Data is stored in `chrome.storage.local` (local to your browser profile)
- No backend, no accounts, no external servers
