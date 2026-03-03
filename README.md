# Target Checkout Helper

Chrome extension to automate Target checkout flow from product page to order review.

## Simplest Windows install (.exe package)

Download these three files from `dist/` and keep them in the same folder:

- `target-checkout-helper-installer.exe`
- `target-checkout-helper.zip`
- `INSTALL.html`

Then:

1. Double-click `target-checkout-helper-installer.exe`
2. Chrome opens to `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select the extracted `target-checkout-helper/` folder shown by the installer

No command-line or admin/root access is required for this flow.

## Quick install (using installer files)

### macOS / Linux

From the repository root:

`chmod +x install.sh`

`./install.sh`

What this does:
- Ensures `target-checkout-helper/` exists (extracts from `dist/target-checkout-helper.zip` if needed)
- Opens Chrome to `chrome://extensions`
- Prints the exact folder path to use for **Load unpacked**

### Windows

From the repository root, run:

`install.bat`

What this does:
- Ensures `target-checkout-helper/` exists (extracts from `dist/target-checkout-helper.zip` if needed)
- Opens Chrome to `chrome://extensions`
- Prints the exact folder path to use for **Load unpacked**

## Install steps in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `target-checkout-helper/` folder
5. Pin the extension, open popup, enter settings, click **Save Settings**

You can also open `INSTALL.html` for a visual installer guide.

## Build the Windows `.exe` installer (maintainers)

From repo root:

`./build_installer_exe.sh`

This produces:
- `dist/target-checkout-helper-installer.exe`
- `dist/INSTALL.html` (copied for distribution)

## Notes

- Data is stored in `chrome.storage.local` (local browser storage).
- The extension is designed to stop before final order submission; review remains manual.
