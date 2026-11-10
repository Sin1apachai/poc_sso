const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
// Validate repository source; leave unrelated local scratch files alone.
const tracked = new Set(execFileSync("git", ["ls-files", "-z"]).toString().split("\0"));
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "legacy"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (tracked.has(file) && /\.(js|cjs)$/.test(file)) {
      execFileSync(process.execPath, ["--check", file]);
      const text = fs.readFileSync(file, "utf8");
      for (const m of file.startsWith("scripts/")
        ? []
        : text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        require.resolve(path.resolve(path.dirname(file), m[1]));
      }
      count++;
    } else if (tracked.has(file) && file.endsWith(".ejs")) {
      require("../app/node_modules/ejs").compile(fs.readFileSync(file, "utf8"), { filename: file });
    }
  }
}
for (const dir of [
  "app/src",
  "app/public",
  "app/views",
  "app-control/src",
  "app-control/public",
  "app-control/views",
  "scripts",
])
  walk(dir);
console.log(`Checked ${count} JavaScript files, local imports and EJS templates.`);
