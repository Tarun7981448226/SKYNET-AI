#!/usr/bin/env node
// Extracts the first frame of the wallpaper video as a poster image, shown
// instantly while the (33MB, 4K) video itself is still loading. Run this
// again any time the wallpaper video file is replaced.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const assetsDir = path.join(import.meta.dirname, "..", "public", "assets");
const videoPath = path.join(assetsDir, "skynet_wallpaper.mp4");
const posterPath = path.join(assetsDir, "skynet_wallpaper_poster.jpg");

if (!existsSync(videoPath)) {
  console.error(`Wallpaper video not found at ${videoPath} — nothing to generate a poster from.`);
  process.exit(1);
}

try {
  execFileSync("ffmpeg", ["-y", "-i", videoPath, "-vframes", "1", "-update", "1", "-q:v", "3", posterPath], {
    stdio: "inherit",
  });
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("ffmpeg is not installed/on PATH — install it (e.g. `brew install ffmpeg`) and re-run this script.");
    process.exit(1);
  }
  throw err;
}

console.log(`Wrote ${posterPath}`);
