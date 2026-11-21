#!/usr/bin/env node
/**
 * Entry point for the "Leonida Drawbridge Jump" clipper entry.
 *
 * What it does:
 *   1. Loads VIDEO.json from this script's own directory.
 *   2. Checks that the `url` field really points at a YouTube video
 *      (a /shorts/<id> link, a /watch?v=<id> link, or a youtu.be/<id> link).
 *   3. Copies VIDEO.json into the output directory named on the command
 *      line (argv[2]); when no directory is given it falls back to ./output.
 *
 * Standard library only. No network access is needed or performed.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface VideoManifest {
  url: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "VIDEO.json");

// Hosts that legitimately serve YouTube watch/shorts pages.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

// YouTube video ids are 11 characters drawn from this alphabet.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readManifest(path: string): VideoManifest {
  if (!existsSync(path)) {
    fail(`VIDEO.json not found next to main.ts (looked in ${here})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("VIDEO.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    fail("VIDEO.json must contain a JSON object");
  }
  const url = (parsed as Record<string, unknown>).url;
  if (typeof url !== "string" || url.length === 0) {
    fail('VIDEO.json must carry a non-empty string field named "url"');
  }
  return { url };
}

/** Returns the video id when `raw` is a genuine YouTube video URL, else null. */
function youtubeVideoId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(u.hostname)) return null;

  // Short share links: https://youtu.be/<id>
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return VIDEO_ID.test(id) ? id : null;
  }

  // Shorts: https://www.youtube.com/shorts/<id>
  const shorts = u.pathname.match(/^\/shorts\/([^/]+)$/);
  if (shorts) {
    return VIDEO_ID.test(shorts[1]) ? shorts[1] : null;
  }

  // Classic watch page: https://www.youtube.com/watch?v=<id>
  if (u.pathname === "/watch") {
    const v = u.searchParams.get("v");
    return v !== null && VIDEO_ID.test(v) ? v : null;
  }

  return null;
}

function main(): void {
  const manifest = readManifest(manifestPath);

  const id = youtubeVideoId(manifest.url);
  if (id === null) {
    fail(`not a well-formed YouTube video URL: ${manifest.url}`);
  }

  const outDir = resolve(process.argv[2] ?? join(here, "output"));
  mkdirSync(outDir, { recursive: true });

  const target = join(outDir, "VIDEO.json");
  copyFileSync(manifestPath, target);

  console.log(`video id : ${id}`);
  console.log(`video url: ${manifest.url}`);
  console.log(`copied   : ${manifestPath} -> ${target}`);
}

main();
