#!/usr/bin/env node
/**
 * Download static ffmpeg/ffprobe binaries and place them where Tauri expects
 * sidecars: src-tauri/binaries/<name>-<rust-target-triple>[.exe]
 *
 *   node scripts/fetch-ffmpeg.mjs                      # host triple
 *   node scripts/fetch-ffmpeg.mjs --target aarch64-apple-darwin
 *   node scripts/fetch-ffmpeg.mjs --all                # every supported triple
 *
 * Source: github.com/eugeneware/ffmpeg-static — one uniform release that ships
 * both ffmpeg and ffprobe as fully static, dependency-free builds for every
 * platform we ship. These are GPL builds (see LICENSE note in DESKTOP.md).
 */
import { createWriteStream } from 'node:fs';
import { mkdir, chmod, stat, rm, readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;

/** Rust target triple -> ffmpeg-static asset suffix */
const TARGETS = {
	'x86_64-unknown-linux-gnu': 'linux-x64',
	'aarch64-unknown-linux-gnu': 'linux-arm64',
	'x86_64-apple-darwin': 'darwin-x64',
	'aarch64-apple-darwin': 'darwin-arm64',
	'x86_64-pc-windows-msvc': 'win32-x64',
};

// Namespaced on purpose. Tauri installs sidecars beside the main executable,
// which on a .deb is /usr/bin — so a sidecar plainly named "ffmpeg" collides
// with the distro's own ffmpeg package and dpkg refuses the install.
const BINARIES = [
	{ asset: 'ffmpeg', out: 'loomo-ffmpeg' },
	{ asset: 'ffprobe', out: 'loomo-ffprobe' },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'src-tauri', 'binaries');

function hostTriple() {
	try {
		const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
		const m = out.match(/^host:\s*(\S+)$/m);
		if (m) return m[1];
	} catch {
		/* rustc not on PATH — fall through to a platform guess */
	}
	const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
	if (process.platform === 'darwin') return `${arch}-apple-darwin`;
	if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
	return `${arch}-unknown-linux-gnu`;
}

async function exists(p) {
	try {
		const s = await stat(p);
		return s.size > 1_000_000; // a real ffmpeg build, not a stub or error page
	} catch {
		return false;
	}
}

async function download({ asset, out }, triple) {
	const suffix = TARGETS[triple];
	const isWin = triple.includes('windows');
	const dest = path.join(outDir, `${out}-${triple}${isWin ? '.exe' : ''}`);

	if (await exists(dest)) {
		console.log(`  ✓ ${path.basename(dest)} (cached)`);
		return dest;
	}

	const url = `${BASE}/${asset}-${suffix}.gz`;
	process.stdout.write(`  ↓ ${path.basename(dest)} … `);

	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);

	const tmp = `${dest}.part`;
	await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
	await rm(dest, { force: true });
	const { rename } = await import('node:fs/promises');
	await rename(tmp, dest);
	if (!isWin) await chmod(dest, 0o755);

	const { size } = await stat(dest);
	if (size < 1_000_000) throw new Error(`${dest} is only ${size} bytes — bad download`);
	console.log(`${(size / 1e6).toFixed(1)} MB`);
	return dest;
}

/** Sanity-check: if we fetched for the host, the binary must actually run. */
function verify(binPath, triple) {
	if (triple !== hostTriple()) return;
	const out = execFileSync(binPath, ['-version'], { encoding: 'utf8' });
	const v = out.split('\n')[0];
	console.log(`  ⇢ verified: ${v}`);
}

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const idx = argv.indexOf('--target');
const triples = all ? Object.keys(TARGETS) : [idx !== -1 ? argv[idx + 1] : hostTriple()];

await mkdir(outDir, { recursive: true });

for (const triple of triples) {
	if (!TARGETS[triple]) {
		console.error(`\n✗ Unsupported target "${triple}".`);
		console.error(`  Supported: ${Object.keys(TARGETS).join(', ')}`);
		process.exit(1);
	}
	console.log(`\n${triple}`);
	for (const binary of BINARIES) {
		const p = await download(binary, triple);
		if (binary.asset === 'ffmpeg') verify(p, triple);
	}
}

// Keep the license alongside the binaries — these are GPL builds.
const licensePath = path.join(outDir, 'FFMPEG-LICENSE.txt');
if (!(await exists(licensePath))) {
	try {
		const res = await fetch(`${BASE}/${TARGETS[triples[0]]}.LICENSE`);
		if (res.ok) {
			const { writeFile } = await import('node:fs/promises');
			await writeFile(licensePath, await res.text());
		}
	} catch {
		/* non-fatal */
	}
}

console.log(`\nSidecars ready in ${path.relative(process.cwd(), outDir)}/`);
