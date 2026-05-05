import fs from "fs";
const s = fs.readFileSync(
  new URL("../discord-chat-exporter-testenv/dash/dash.js", import.meta.url),
  "utf8",
);
const needle = "return await z(i)}";
const j = s.indexOf(needle);
console.log("idx", j);
console.log(s.slice(j - 800, j + 50));
