import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist");

const files = [
  "index.html",
  "app.js",
  "styles.css",
  "photos.js",
  ".nojekyll"
];

const dirs = ["photos", "music"];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (existsSync(source)) {
    await copyFile(source, path.join(outDir, file));
  }
}

for (const dir of dirs) {
  const source = path.join(root, dir);
  if (existsSync(source)) {
    await cp(source, path.join(outDir, dir), { recursive: true });
  }
}

console.log("Static site copied to dist.");
