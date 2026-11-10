const fs = require("node:fs");
const { html } = require("js-beautify");
const prettier = require("prettier");

async function main() {
  const check = process.argv.includes("--check");
  let changed = false;

  for (const directory of ["app/views", "app-control/views"]) {
    const templates = fs.readdirSync(directory).filter((name) => name.endsWith(".ejs"));

    for (const name of templates) {
      const file = `${directory}/${name}`;
      const before = fs.readFileSync(file, "utf8");
      const blocks = [];

      // HTML formatters otherwise treat EJS control flow as inline text.
      const protectedSource = before.replace(/<%(?![=])([\s\S]*?)%>/g, (tag, code) => {
        blocks.push({ tag, code });
        return `\n<!-- SSO_TEMPLATE_BLOCK_${blocks.length - 1} -->\n`;
      });

      let after = html(protectedSource, {
        indent_size: 2,
        wrap_line_length: 100,
        wrap_attributes: "auto",
        templating: ["erb"],
        extra_liners: [],
        end_with_newline: true,
        preserve_newlines: false,
        indent_inner_html: true,
        inline: [],
      });

      for (let index = 0; index < blocks.length; index++) {
        const { tag, code } = blocks[index];
        let formattedTag = tag.trim();

        if (tag.startsWith("<%-")) {
          after = after.replace(`<!-- SSO_TEMPLATE_BLOCK_${index} -->`, () => tag);
          continue;
        }

        try {
          // Complete declarations can be formatted; opening/closing control blocks cannot.
          const formattedCode = (await prettier.format(code.trim(), { parser: "babel" })).trim();
          if (formattedCode.includes("\n")) {
            formattedTag = `<%\n${formattedCode}\n%>`;
          } else {
            formattedTag = `<% ${formattedCode} %>`;
          }
        } catch {
          // Keep incomplete EJS control blocks intact.
        }

        after = after.replace(`<!-- SSO_TEMPLATE_BLOCK_${index} -->`, () => formattedTag);
      }

      if (before !== after) {
        changed = true;
        if (check) console.error(`Template needs formatting: ${file}`);
        else fs.writeFileSync(file, after);
      }
    }
  }

  if (check && changed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
