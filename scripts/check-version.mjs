// The version is written in four places. Fails when they disagree, or when a
// release tag (argument or GITHUB_REF_NAME on a tag ref) does not match them.
import { readFileSync } from "node:fs";
import process from "node:process";
import { printHelpAndExit, rejectUnknownArguments } from "./help.mjs";

printHelpAndExit(`
Usage: pnpm check:version [tag]

Checks that package.json, extension/manifest.json, the VERSION constant in
extension/content.js and the footer of extension/popup.html carry the same
version, and that tag (v-prefixed or not) matches it when given. In GitHub
Actions on a tag ref the tag defaults to GITHUB_REF_NAME.
`);
rejectUnknownArguments({});

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const found = {
  "package.json": JSON.parse(read("package.json")).version,
  "extension/manifest.json": JSON.parse(read("extension/manifest.json")).version,
  "extension/content.js": read("extension/content.js").match(/const VERSION = "([^"]+)"/)?.[1],
  "extension/popup.html": read("extension/popup.html").match(/class="ver">v([^<]+)</)?.[1],
};

const tag =
  process.argv.slice(2).find((argument) => !argument.startsWith("-")) ??
  (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);

if (tag !== undefined) found[`tag ${tag}`] = tag.replace(/^v/, "");

const versions = new Set(Object.values(found));

if (versions.size !== 1 || versions.has(undefined)) {
  for (const [where, version] of Object.entries(found)) {
    console.error(`${where}: ${version ?? "not found"}`);
  }
  process.exit(1);
}

console.log(`version ${[...versions][0]}`);
