#!/usr/bin/env node
/**
 * Renders the 1024×1024 source icon that `tauri icon` slices into every
 * platform format. Written as a raw PNG encoder so the build has no image
 * dependency — the whole thing is zlib, which ships with Node.
 *
 * Design follows the app palette in apps/web/src/app.css: a near-black rounded
 * square with the record-red accent as a ring and dot.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = 3; // supersample factor — cheap anti-aliasing
const W = SIZE * SS;

const BG_TOP = [0x21, 0x21, 0x24];
const BG_BOTTOM = [0x0b, 0x0b, 0x0d];
const RED = [0xff, 0x33, 0x33];
const WHITE = [0xff, 0xff, 0xff];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(px, py, halfW, halfH, radius) {
	const qx = Math.abs(px) - halfW + radius;
	const qy = Math.abs(py) - halfH + radius;
	const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
	return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

// Accumulate supersampled colour, then average down to one pixel.
const acc = new Float64Array(SIZE * SIZE * 4);

const half = W / 2;
const squircleHalf = W * 0.46;
const squircleRadius = W * 0.155;
const ringOuter = W * 0.245;
const ringInner = W * 0.195;
const dotRadius = W * 0.115;

for (let y = 0; y < W; y++) {
	const py = y - half + 0.5;
	for (let x = 0; x < W; x++) {
		const px = x - half + 0.5;

		let r = 0,
			g = 0,
			b = 0,
			a = 0;

		if (sdRoundRect(px, py, squircleHalf, squircleHalf, squircleRadius) <= 0) {
			// Vertical gradient across the tile.
			const t = (y / W) * 0.85 + 0.075;
			[r, g, b] = mix(BG_TOP, BG_BOTTOM, t);
			a = 255;

			const dist = Math.hypot(px, py);

			if (dist <= dotRadius) {
				[r, g, b] = RED;
			} else if (dist >= ringInner && dist <= ringOuter) {
				// Ring fades from red at the bottom to white at the top, which
				// keeps it legible on both light and dark desktop wallpapers.
				const sweep = (py / ringOuter + 1) / 2;
				[r, g, b] = mix(WHITE, RED, Math.min(Math.max(sweep, 0), 1));
			}
		}

		const dx = Math.floor(x / SS);
		const dy = Math.floor(y / SS);
		const o = (dy * SIZE + dx) * 4;
		acc[o] += r;
		acc[o + 1] += g;
		acc[o + 2] += b;
		acc[o + 3] += a;
	}
}

// PNG scanlines: one filter byte (0 = none) per row, then RGBA.
const samples = SS * SS;
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
for (let y = 0; y < SIZE; y++) {
	raw[p++] = 0;
	for (let x = 0; x < SIZE; x++) {
		const o = (y * SIZE + x) * 4;
		raw[p++] = Math.round(acc[o] / samples);
		raw[p++] = Math.round(acc[o + 1] / samples);
		raw[p++] = Math.round(acc[o + 2] / samples);
		raw[p++] = Math.round(acc[o + 3] / samples);
	}
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	chunk('IDAT', deflateSync(raw, { level: 9 })),
	chunk('IEND', Buffer.alloc(0)),
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'src-tauri', 'icons', 'source.png');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png);

console.log(`Wrote ${path.relative(process.cwd(), out)} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);
console.log('Next: bunx @tauri-apps/cli icon src-tauri/icons/source.png');
