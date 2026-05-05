import fs from "fs";
const s = fs.readFileSync(
  new URL("../discord-chat-exporter-testenv/dash/dash.js", import.meta.url),
  "utf8",
);
const needle = 'server_value("max_per_file"';
console.log("count", s.split(needle).length - 1);
