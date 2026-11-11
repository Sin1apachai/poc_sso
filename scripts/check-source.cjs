const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
// Check every current source file, including files not yet committed.
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|cjs)$/.test(file)) {
      execFileSync(process.execPath, ["--check", file]);
      const text = fs.readFileSync(file, "utf8");
      for (const m of file.startsWith("scripts/")
        ? []
        : text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        require.resolve(path.resolve(path.dirname(file), m[1]));
      }
      count++;
    } else if (file.endsWith(".ejs")) {
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
