Target Checkout Helper
======================

Chrome extension to automate Target checkout flow from product page to order review.

INSTALLATION (Windows, easiest)
-------------------------------

After using GitHub "Code -> Download ZIP":

1) Extract the downloaded repository ZIP.
2) In the extracted top-level folder, double-click:
   target-checkout-helper-installer.exe
3) Chrome opens to chrome://extensions
4) Turn ON Developer mode
5) Click "Load unpacked"
6) Select:
   target-checkout-helper/

No terminal commands or admin/root access are required for this Windows flow.

Important:
- Keep installer files in the extracted repo folder.
- The installer can use either:
  - target-checkout-helper/ (already unpacked), or
  - target-checkout-helper.zip (payload ZIP in repo root), or
  - dist/target-checkout-helper.zip (fallback location)
- If you move the .exe elsewhere, move target-checkout-helper.zip with it.

Alternative Windows package:
- dist/target-checkout-helper-installer-bundle.zip
  (contains installer.exe + target-checkout-helper.zip + INSTALL.html)

INSTALLATION (macOS / Linux)
----------------------------

From repo root:

chmod +x install.sh
./install.sh

Then in Chrome:
1) Open chrome://extensions (script can open it)
2) Turn ON Developer mode
3) Click "Load unpacked"
4) Select target-checkout-helper/

No sudo is required for normal usage.

WINDOWS FALLBACK (script)
-------------------------

If you do not want to use the .exe, run:

install.bat

It performs the same extract + open-Chrome flow.

NOTES
-----

- Data is stored in chrome.storage.local (local browser storage).
- Extension stops before final order submission; review remains manual.
- Open INSTALL.html for visual step-by-step instructions.
