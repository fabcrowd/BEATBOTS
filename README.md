# Target Checkout Helper

Chrome extension to automate Target checkout flow from product page to order review.

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

## Notes

- Data is stored in `chrome.storage.local` (local browser storage).
- The extension is designed to stop before final order submission; review remains manual.
