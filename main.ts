#!/usr/bin/env node
/**
 * Entry point for the "Leonida Drawbridge Jump" clipper entry.
 *
 * What it does:
 *   1. Loads VIDEO.json from this script's own directory.
 *   2. Checks that the `url` field really points at a YouTube video
 *      (a /shorts/<id> link, a /watch?v=<id> link, or a youtu.be/<id> link).
 *      When the URL is rejected, the error message names the exact problem
 *      (unparseable, wrong host, unsupported path, malformed id, ...).
 *   3. Copies VIDEO.json into the output directory: `--out <dir>` (or
 *      `--out=<dir>`), else the first positional argument, else ./output
 *      next to this script.
 *   4. Re-reads the copy and compares its bytes with the source, so a
 *      truncated or corrupted copy is reported instead of passing silently,
 *      then prints a one-line summary of what was copied and for which video.
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
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`VIDEO.json is not valid JSON (${detail})`);
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

type UrlVerdict = { id: string } | { problem: string };

/**
 * Checks whether `raw` is a genuine YouTube video URL. On success the video
 * id is returned; on failure `problem` says precisely what is wrong, so the
 * caller can show the user a fixable message instead of a bare "invalid".
 */
function youtubeVideoId(raw: string): UrlVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { problem: "the value is not a parseable URL at all" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { problem: `the scheme is "${u.protocol}", expected http: or https:` };
  }
  if (!YOUTUBE_HOSTS.has(u.hostname)) {
    return {
      problem: `the host is "${u.hostname}", not a YouTube host (${[...YOUTUBE_HOSTS].join(", ")})`,
    };
  }

  // A candidate id is only accepted when it has YouTube's exact id shape.
  const checkId = (candidate: string, where: string): UrlVerdict =>
    VIDEO_ID.test(candidate)
      ? { id: candidate }
      : {
          problem: `the video id in ${where} is "${candidate}", but a YouTube id is exactly 11 characters of A-Z, a-z, 0-9, "-" or "_"`,
        };

  // Short share links: https://youtu.be/<id>
  if (u.hostname === "youtu.be") {
    return checkId(u.pathname.slice(1), "the youtu.be path");
  }

  // Shorts: https://www.youtube.com/shorts/<id>
  const shorts = u.pathname.match(/^\/shorts\/([^/]+)$/);
  if (shorts) {
    return checkId(shorts[1], "the /shorts/ path");
  }
  if (u.pathname.startsWith("/shorts")) {
    return { problem: `the path "${u.pathname}" is not of the form /shorts/<id>` };
  }

  // Classic watch page: https://www.youtube.com/watch?v=<id>
  if (u.pathname === "/watch") {
    const v = u.searchParams.get("v");
    if (v === null) {
      return { problem: 'the /watch URL carries no "v" query parameter naming the video' };
    }
    return checkId(v, 'the "v" query parameter');
  }

  return {
    problem: `the path "${u.pathname}" is not a video page (expected /shorts/<id>, /watch?v=<id>, or a youtu.be/<id> link)`,
  };
}

/**
 * Picks the output directory from the command line: `--out <dir>` or
 * `--out=<dir>` wins, then the first positional argument, then ./output
 * next to this script. Unknown flags are rejected with a usage hint.
 */
function parseOutDir(argv: string[]): string {
  let chosen: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined) {
        fail("--out needs a directory after it, e.g. --out /tmp/entry-out");
      }
      chosen = value;
      i++;
    } else if (arg.startsWith("--out=")) {
      chosen = arg.slice("--out=".length);
      if (chosen.length === 0) {
        fail("--out= needs a directory after the =, e.g. --out=/tmp/entry-out");
      }
    } else if (arg.startsWith("--")) {
      fail(`unknown option "${arg}" (usage: node main.ts [--out <dir> | <dir>])`);
    } else if (chosen === undefined) {
      chosen = arg;
    }
  }
  return resolve(chosen ?? join(here, "output"));
}

function main(): void {
  const manifest = readManifest(manifestPath);

  const verdict = youtubeVideoId(manifest.url);
  if ("problem" in verdict) {
    fail(`VIDEO.json "url" is not a well-formed YouTube video URL: ${verdict.problem} (got: ${manifest.url})`);
  }

  const outDir = parseOutDir(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const target = join(outDir, "VIDEO.json");
  copyFileSync(manifestPath, target);

  // Trust nothing: re-read both files and compare byte-for-byte, so a
  // truncated or corrupted copy fails loudly instead of shipping silently.
  const sourceBytes = readFileSync(manifestPath);
  const copiedBytes = readFileSync(target);
  if (!copiedBytes.equals(sourceBytes)) {
    fail(
      `copy verification failed: ${target} holds ${copiedBytes.length} bytes but the source holds ${sourceBytes.length}, or the bytes differ`,
    );
  }

  console.log(`video id : ${verdict.id}`);
  console.log(`video url: ${manifest.url}`);
  console.log(`copied   : ${manifestPath} -> ${target}`);
  console.log(
    `summary  : copied VIDEO.json (${sourceBytes.length} bytes, verified byte-identical) for YouTube video ${verdict.id} into ${outDir}`,
  );
}

main();
