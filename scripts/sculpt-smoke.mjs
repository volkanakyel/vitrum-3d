#!/usr/bin/env node
/**
 * Live smoke test for the sculpt routes. Needs a dev server with the key:
 *
 *   NUXT_ANTHROPIC_KEY=... pnpm dev           # or put it in .env
 *   # a key that is not scoped to a workspace also needs NUXT_ANTHROPIC_WORKSPACE_ID
 *   node scripts/sculpt-smoke.mjs <image.jpg|png> [--base=http://localhost:3000] [--build]
 *
 * Posts the photo to /api/sculpt/plan and prints the plan with its tokens and
 * cost. With --build it also asks /api/sculpt/build for the model and writes
 * it next to the photo as <name>.sculpt.js. Pass a photo of one object on a
 * plain background.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const baseArg = args.find(a => a.startsWith('--base='))
const base = baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000'
const build = args.includes('--build')
const imagePath = args.find(a => !a.startsWith('--'))

if (!imagePath) {
  console.error('usage: node scripts/sculpt-smoke.mjs <image.jpg|png> [--base=http://localhost:3000] [--build]')
  process.exit(2)
}

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

const image = readFileSync(imagePath).toString('base64')

console.log(`image: ${imagePath} (${(image.length * 0.75 / 1024).toFixed(0)} kB)`)
console.log(`server: ${base}`)

const started = Date.now()
const plan = report('plan', await post('/api/sculpt/plan', { image }))
const spec = plan.data
console.log(`  ${spec.name} — ${spec.objectClass}, verdict ${spec.suitability.verdict}`)
console.log(`  dimensions: ${spec.dimensions.widthM} × ${spec.dimensions.heightM} × ${spec.dimensions.depthM} m (${spec.dimensions.source})`)
console.log(`  camera: yaw ${spec.camera.yaw}, pitch ${spec.camera.pitch}, fov ${spec.camera.fov}, distance ${spec.camera.distance}`)
console.log(`  components: ${spec.components.map(c => c.id).join(', ')}`)
console.log(`  materials: ${spec.materials.map(m => `${m.id}(${m.family})`).join(', ')}`)
console.log('  mustMatch:')
for (const fact of spec.mustMatch) console.log(`    - ${fact}`)

let totalIn = plan.usage.input
let totalOut = plan.usage.output
let totalCost = plan.costUsd

if (build) {
  const built = report('build', await post('/api/sculpt/build', { spec, image }))
  const out = imagePath.replace(/\.[^.]+$/, '') + '.sculpt.js'
  writeFileSync(out, built.data.code)
  console.log(`  ${built.data.code.length} chars → ${out}`)
  for (const note of built.data.notes) console.log(`    - ${note}`)
  totalIn += built.usage.input
  totalOut += built.usage.output
  totalCost += built.costUsd
}

console.log(`\ntotal: ${totalIn} in / ${totalOut} out tokens, $${totalCost.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)}s`)
