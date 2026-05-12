// Run with: node build/generate-icons.mjs
// Requires: npm install -g sharp  (or: npm install --save-dev sharp)
// Generates icon.png from the SVG source, then converts to ICO/ICNS.
//
// For quick testing without icon generation, electron-builder will use
// a default Electron icon if build/icon.ico does not exist.

import { createCanvas } from 'canvas'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Draw the BEATBOTS icon: red circle with "BB" monogram
function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  const r = size / 2

  // Background — deep black
  ctx.fillStyle = '#0f0f10'
  ctx.fillRect(0, 0, size, size)

  // Red circle
  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.arc(r, r, r * 0.82, 0, Math.PI * 2)
  ctx.fill()

  // White "BB" text
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.floor(size * 0.38)}px "Arial"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('BB', r, r + size * 0.02)

  return canvas.toBuffer('image/png')
}

// Output sizes
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

for (const size of sizes) {
  const buf = drawIcon(size)
  fs.writeFileSync(path.join(__dirname, `icon-${size}.png`), buf)
  console.log(`Generated icon-${size}.png`)
}

// Copy 512 as the main icon
fs.copyFileSync(path.join(__dirname, 'icon-512.png'), path.join(__dirname, 'icon.png'))
console.log('Done. Use electron-builder or a tool like png2ico to create icon.ico from icon-256.png')
