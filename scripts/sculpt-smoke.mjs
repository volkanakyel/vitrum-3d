#!/usr/bin/env node
/**
 * Live smoke test for the sculpt routes. Needs a dev server with the key:
 *
 *   NUXT_ANTHROPIC_KEY=... pnpm dev           # or put it in .env
 *   # a key that is not scoped to a workspace also needs NUXT_ANTHROPIC_WORKSPACE_ID
 *   node scripts/sculpt-smoke.mjs <image.jpg|png> [--base=http://localhost:3000]
 *
 * Posts the photo to /api/sculpt/intake, feeds the intake to /api/sculpt/spec,
 * and prints both results with their tokens and cost. Pass a photo of one object
 * on a plain background — a comparison sheet with two panels is two objects, and
 * the intake will say so.
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const baseArg = args.find(a => a.startsWith('--base='))
const base = baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000'
const imagePath = args.find(a => !a.startsWith('--'))

if (!imagePath) {
  console.error('usage: node scripts/sculpt-smoke.mjs <image.jpg|png> [--base=http://localhost:3000]')
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

const intake = report('intake', await post('/api/sculpt/intake', { image }))
console.log(`  ${intake.data.name} — ${intake.data.objectClass}, verdict ${intake.data.suitability.verdict}`)
console.log(`  dimensions: ${intake.data.dimensions.widthM} × ${intake.data.dimensions.heightM} × ${intake.data.dimensions.depthM} m (${intake.data.dimensions.source})`)
console.log(`  camera: yaw ${intake.data.camera.yaw}, pitch ${intake.data.camera.pitch}, fov ${intake.data.camera.fov}, distance ${intake.data.camera.distance}`)
console.log(`  details: ${intake.data.detailInventory.length}, materials: ${intake.data.materialsSeen.length}`)

const spec = report('spec', await post('/api/sculpt/spec', { intake: intake.data, image }))
console.log(`  components: ${spec.data.components.map(c => c.id).join(', ')}`)
console.log(`  materials: ${spec.data.materials.map(m => `${m.id}(${m.family})`).join(', ')}`)
console.log('  mustMatch:')
for (const fact of spec.data.mustMatch) console.log(`    - ${fact}`)

const totalIn = intake.usage.input + spec.usage.input
const totalOut = intake.usage.output + spec.usage.output
console.log(`\ntotal: ${totalIn} in / ${totalOut} out tokens, $${(intake.costUsd + spec.costUsd).toFixed(4)}`)
