# Target Checkout Helper

Chrome extension to automate Target checkout flow from product page to order review.

## Install instructions by OS

### Windows (recommended: `.exe` installer)

#### Easiest (single ZIP bundle)

Use:

- `dist/target-checkout-helper-installer-bundle.zip`

Steps:

1. Extract `target-checkout-helper-installer-bundle.zip`
2. Double-click `target-checkout-helper-installer.exe`
3. In Chrome, turn on **Developer mode**
4. Click **Load unpacked**
5. Select the extracted `target-checkout-helper/` folder shown by the installer

#### Manual 3-file package (equivalent)

If needed, keep these files together in one folder:

- `target-checkout-helper-installer.exe`
- `target-checkout-helper.zip`
- `INSTALL.html`

Then:

1. Double-click `target-checkout-helper-installer.exe`
2. Chrome opens to `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select the extracted `target-checkout-helper/` folder shown by the installer

This is the easiest path for average Windows users (no terminal needed).

#### If you used GitHub "Code → Download ZIP"

After extracting the repo ZIP, go to `dist/` and use:

- `target-checkout-helper-installer-bundle.zip` (recommended), or
- the 3-file package listed above.

### macOS / Linux (`install.sh`)

From the repo root:

`chmod +x install.sh`

`./install.sh`

Then in Chrome:

1. Open `chrome://extensions` (script can open it for you)
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select `target-checkout-helper/`

Notes:
- `install.sh` extracts from `dist/target-checkout-helper.zip` if needed
- No `sudo` is required for normal usage

### Windows fallback (`install.bat`)

If you do not want to use the `.exe` package, run `install.bat` from the repo root.
It performs the same extract + open-Chrome flow.

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
- `dist/target-checkout-helper-installer-bundle.zip` (single downloadable installer package)

## Notes

- Data is stored in `chrome.storage.local` (local browser storage).
- The extension is designed to stop before final order submission; review remains manual.
