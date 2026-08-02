// Dependency-free raster companion for icon.svg.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 180;
const pixels = Buffer.alloc(W * W * 4);
const colors = {
  night: [23, 44, 59, 255], porch: [167, 83, 56, 255],
  dark: [116, 53, 31, 255], cream: [255, 244, 213, 255],
  lemon: [246, 206, 103, 255], ink: [34, 42, 43, 255],
  edge: [180, 171, 148, 255], wire: [8, 23, 31, 255],
};

function set(x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  pixels.set(color, i);
}
function rect(x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, color);
}
function circle(cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) set(x, y, color);
  }
}
function line(x1, y1, x2, y2, width, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * i / steps);
    const y = Math.round(y1 + (y2 - y1) * i / steps);
    circle(x, y, Math.floor(width / 2), color);
  }
}

rect(0, 0, W, W, colors.night);
rect(0, 125, W, 55, colors.porch);
rect(0, 142, W, 5, colors.dark);
rect(0, 161, W, 5, colors.dark);
line(0, 25, 50, 37, 3, colors.wire);
line(50, 37, 95, 27, 3, colors.wire);
line(95, 27, 180, 36, 3, colors.wire);
for (const [x, y] of [[22,34], [58,37], [96,28], [136,31], [167,36]]) circle(x, y, 6, colors.lemon);

// Cream domino with a warm shadow and center rule.
rect(34, 66, 112, 60, colors.edge);
rect(38, 70, 104, 52, colors.cream);
rect(88, 70, 4, 52, colors.edge);
for (const [x, y] of [[53,83], [64,96], [75,109], [108,83], [129,83], [108,109], [129,109]]) circle(x, y, 5, colors.ink);
rect(30, 145, 120, 4, colors.lemon);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(W, 0); header.writeUInt32BE(W, 4);
header[8] = 8; header[9] = 6;
const scanlines = Buffer.alloc((W * 4 + 1) * W);
for (let y = 0; y < W; y++) pixels.copy(scanlines, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../icon-180.png', import.meta.url), png);
