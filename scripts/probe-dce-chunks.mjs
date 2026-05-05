import fs from "fs";
const s = fs.readFileSync(
  new URL("../discord-chat-exporter-testenv/dash/dash.js", import.meta.url),
  "utf8",
);
const needles = [
  "max_per_file",
  "server_value",
  "d.length>=",
  "onMultiHtml",
  "limit=50",
  "file_type",
  "html",
  "xlsx",
];
for (const n of needles) {
  let i = 0;
  let c = 0;
  while (c < 5) {
    const j = s.indexOf(n, i);
    if (j < 0) break;
    console.log(
      "\n===",
      n,
      "@",
      j,
      "===\n",
      s.slice(Math.max(0, j - 60), j + 140).replace(/\s+/g, " "),
    );
    i = j + n.length;
    c++;
  }
}
