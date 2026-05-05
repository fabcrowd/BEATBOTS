import fs from "fs";
import path from "path";

const SRC = path.resolve("discord-chat-exporter-local");
const DST = path.resolve("discord-chat-exporter-testenv");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, name.name);
    const d = path.join(dst, name.name);
    if (name.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(SRC)) {
  console.error("Missing", SRC);
  process.exit(1);
}
if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true });
copyDir(SRC, DST);

const dashPath = path.join(DST, "dash", "dash.js");
let s = fs.readFileSync(dashPath, "utf8");

const patches = [
  // Token check: no network; always premium / pro
  [
    ',o=chrome.runtime.getManifest().version,l=a+"check-token.php?token="+encodeURIComponent(t)+"&version="+encodeURIComponent(o)+"&chn=chrome-extension",c=new AbortController,u=setTimeout(()=>c.abort(),s);let h,d;try{h=await fetch(l,{signal:c.signal})}catch(e){if(e&&"AbortError"===e.name)throw new Error("check-token: timeout");throw e}finally{clearTimeout(u)}if(!h.ok)throw new Error("check-token: HTTP "+h.status);try{d=await h.json()}catch(e){throw new Error("check-token: invalid JSON")}let f=0!=d.premium;',
    ',o=chrome.runtime.getManifest().version;const d={premium:1,sub_status:"1",trial:null,notice:null,open_link:null};let f=1;',
  ],
  ["freeMessageCap:()=>500", "freeMessageCap:()=>9007199254740991"],
  ["freeExportCap:()=>500", "freeExportCap:()=>9007199254740991"],
  // Free-tier range estimator: always unlimited
  [
    "if(e.is_pro||!r||500!==t)return{hitFreeLimit:!1,estimateRemaining:null};",
    "if(1)return{hitFreeLimit:!1,estimateRemaining:null};",
  ],
  // XLSX / HTML hard caps (comma-operator if conditions)
  [",!e.is_pro&&s>=500){", ",0){"],
  [",!e.is_pro&&i>=500){", ",0){"],
  // XLSX cap message still references 500 in string — bump display cap in i18n path uses freeExportCap already
];

let n = 0;
for (const [from, to] of patches) {
  const c = s.split(from).length - 1;
  if (c !== 1) {
    console.error("Expected 1 occurrence of patch anchor, got", c, "for:", from.slice(0, 80));
    process.exit(1);
  }
  s = s.replace(from, to);
  n++;
}
fs.writeFileSync(dashPath, s);
console.log("Patched dash.js with", n, "replacements");

// Background: skip onboarding tab to hypercavs
const bgPath = path.join(DST, "background.js");
let bg = fs.readFileSync(bgPath, "utf8");
const bgFrom =
  'if("install"==e.reason){let e="https://hypercavs.com/discord-chat-saver/index.html?chn=chrome-extension";chrome.tabs.create({url:e},(function(e){}))}';
const bgTo = 'if("install"==e.reason){void 0}';
if (bg.includes(bgFrom)) {
  bg = bg.replace(bgFrom, bgTo);
  fs.writeFileSync(bgPath, bg);
  console.log("Patched background.js (no install promo tab)");
} else {
  console.warn("background.js install pattern not found; skip");
}

// Manifest: distinct id hint + drop commercial host permission
const manPath = path.join(DST, "manifest.json");
const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
man.name = "Unlocked Discord Exporter (TEST — no license server)";
man.description =
  "Local test build: license checks stubbed, no hypercavs calls from token flow. Not for redistribution.";
delete man.host_permissions;
fs.writeFileSync(manPath, JSON.stringify(man, null, 3) + "\n");
console.log("Updated manifest.json (name, description, removed host_permissions)");

const note = path.join(DST, "TESTENV.md");
fs.writeFileSync(
  note,
  `# Test-environment fork

This folder is a copy of \`discord-chat-exporter-local/\` with **commercial / license checks removed or stubbed** for your own testing.

## Patches applied (see \`scripts/patch-dce-testenv.mjs\`)

- **dash/dash.js**: \`check-token.php\` fetch replaced with a static premium/pro response; free message caps set to \`Number.MAX_SAFE_INTEGER\`; free-tier export limits in the sync estimator and HTML/XLSX loops disabled.
- **background.js**: first-install tab open to the vendor site removed (no-op).
- **manifest.json**: \`host_permissions\` for hypercavs removed (token check no longer fetches). **Purchase / upgrade links** in the UI may still open hypercavs if clicked — avoid those in test.

## Re-build

\`\`\`bash
node scripts/patch-dce-testenv.mjs
\`\`\`

## Legal

Vendor code remains subject to their license. This build is for **private local QA** only; do not publish as a cracked extension.
`,
);
console.log("Wrote", note);
