#!/usr/bin/env node
/**
 * Live smoke test for the sculpt routes. Needs a dev server with the key:
 *
 *   NUXT_ANTHROPIC_KEY=... pnpm dev           # or put it in .env
 *   # a key that is not scoped to a workspace also needs NUXT_ANTHROPIC_WORKSPACE_ID
 *   node scripts/sculpt-smoke.mjs [image.png] [--full] [--base=http://localhost:3000]
 *
 * Posts the reference photo to /api/sculpt/intake, then feeds the intake to
 * /api/sculpt/spec, and prints both results with their tokens and cost. The
 * default image is the orange chair comparison sheet, whose LEFT HALF is the
 * reference photo — the script crops it unless --full is given.
 */
import { readFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const DEFAULT_IMAGE = '/Users/volkanakyel/Developer/orange-chair-bed/docs/cmp2.png'

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const baseArg = args.find(a => a.startsWith('--base='))
const base = baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000'
const imagePath = args.find(a => !a.startsWith('--')) ?? DEFAULT_IMAGE

// --- a minimal PNG reader/writer, enough to take the left half of a sheet ----

function readChunks(buf) {
  const chunks = []
  let at = 8
  while (at < buf.length) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    chunks.push({ type, data: buf.subarray(at + 8, at + 8 + length) })
    at += length + 12
  }
  return chunks
}

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crcBuf])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Returns the left `fraction` of a non-interlaced 8-bit RGB/RGBA PNG. */
function cropLeft(png, fraction) {
  const chunks = readChunks(png)
  const ihdr = chunks.find(c => c.type === 'IHDR').data
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const depth = ihdr[8]
  const colorType = ihdr[9]
  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`cannot crop this PNG (depth ${depth}, colour type ${colorType}) — pass --full`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp

  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)))
  const pixels = Buffer.alloc(height * stride)
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]
    const row = raw.subarray(at, at + stride)
    at += stride
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      const v = row[x]
      out[x] = filter === 0 ? v
        : filter === 1 ? (v + a) & 0xFF
          : filter === 2 ? (v + b) & 0xFF
            : filter === 3 ? (v + ((a + b) >> 1)) & 0xFF
              : (v + paeth(a, b, c)) & 0xFF
    }
  }

  const newWidth = Math.max(1, Math.floor(width * fraction))
  const newStride = newWidth * bpp
  const outRaw = Buffer.alloc(height * (newStride + 1))
  for (let y = 0; y < height; y++) {
    outRaw[y * (newStride + 1)] = 0
    pixels.copy(outRaw, y * (newStride + 1) + 1, y * stride, y * stride + newStride)
  }

  const newIhdr = Buffer.from(ihdr)
  newIhdr.writeUInt32BE(newWidth, 0)
  return Buffer.concat([
    png.subarray(0, 8),
    chunk('IHDR', newIhdr),
    chunk('IDAT', deflateSync(outRaw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- the smoke run -----------------------------------------------------------

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({ ok: false, error: `non-JSON response (${res.status})` }))
  return { status: res.status, json }
}

function report(label, { status, json }) {
  if (!json.ok) {
    console.error(`\n${label}: FAILED (${status}) — ${json.error}`)
    process.exit(1)
  }
  console.log(`\n${label}: ok (${status})`)
  console.log(`  tokens: ${json.usage.input} in / ${json.usage.output} out   cost: $${json.costUsd.toFixed(4)}`)
  return json
}

const file = readFileSync(imagePath)
const isPng = file[0] === 0x89 && file[1] === 0x50
const wide = isPng && readChunks(file).find(c => c.type === 'IHDR').data.readUInt32BE(0)
  > 1.6 * readChunks(file).find(c => c.type === 'IHDR').data.readUInt32BE(4)
const image = (!flags.has('--full') && isPng && wide ? cropLeft(file, 0.5) : file).toString('base64')

console.log(`image: ${imagePath} (${(image.length * 0.75 / 1024).toFixed(0)} kB base64-decoded)`)
console.log(`server: ${base}`)

const intake = report('intake', await post('/api/sculpt/intake', { image }))
console.log(`  ${intake.data.name} — ${intake.data.objectClass}, verdict ${intake.data.suitability.verdict}`)
console.log(`  dimensions: ${intake.data.dimensions.widthM} × ${intake.data.dimensions.heightM} × ${intake.data.dimensions.depthM} m (${intake.data.dimensions.source})`)
console.log(`  camera: yaw ${intake.data.camera.yaw}, pitch ${intake.data.camera.pitch}, fov ${intake.data.camera.fov}, distance ${intake.data.camera.distance}`)
console.log(`  details: ${intake.data.detailInventory.length}, materials: ${intake.data.materialsSeen.length}`)

const spec = report('spec', await post('/api/sculpt/spec', { intake: intake.data, image }))
console.log(`  components: ${spec.data.components.map(c => c.id).join(', ')}`)
console.log(`  materials: ${spec.data.materials.map(m => `${m.id}(${m.family})`).join(', ')}`)
console.log(`  mustMatch:`)
for (const fact of spec.data.mustMatch) console.log(`    - ${fact}`)

const totalIn = intake.usage.input + spec.usage.input
const totalOut = intake.usage.output + spec.usage.output
console.log(`\ntotal: ${totalIn} in / ${totalOut} out tokens, $${(intake.costUsd + spec.costUsd).toFixed(4)}`)
