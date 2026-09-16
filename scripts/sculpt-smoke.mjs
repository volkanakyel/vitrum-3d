#!/usr/bin/env node
/**
 * Live smoke test for the sculpt routes. Needs a dev server with the key:
 *
 *   NUXT_ANTHROPIC_KEY=... pnpm dev           # or put it in .env
 *   # a key that is not scoped to a workspace also needs NUXT_ANTHROPIC_WORKSPACE_ID
 *   node scripts/sculpt-smoke.mjs <image.jpg|png> [--base=http://localhost:3000] [--build]
 *
 * Posts the photo to /api/sculpt/draft (plan + model in one call) and prints
 * the plan with its tokens and cost; the model is written next to the photo
 * as <name>.sculpt.js. Pass a photo of one object on a plain background.
 */
import { readFileSync, writeFileSync } from 'node:fs'

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

const started = Date.now()
const draft = report('draft', await post('/api/sculpt/draft', { image }))
const spec = draft.data.spec
console.log(`  ${spec.name} — ${spec.objectClass}, verdict ${spec.suitability.verdict}`)
console.log(`  dimensions: ${spec.dimensions.widthM} × ${spec.dimensions.heightM} × ${spec.dimensions.depthM} m (${spec.dimensions.source})`)
console.log(`  camera: yaw ${spec.camera.yaw}, pitch ${spec.camera.pitch}, fov ${spec.camera.fov}, distance ${spec.camera.distance}`)
console.log(`  components: ${spec.components.map(c => c.id).join(', ')}`)
console.log(`  materials: ${spec.materials.map(m => `${m.id}(${m.family})`).join(', ')}`)
console.log('  mustMatch:')
for (const fact of spec.mustMatch) console.log(`    - ${fact}`)

const out = imagePath.replace(/\.[^.]+$/, '') + '.sculpt.js'
writeFileSync(out, draft.data.code)
console.log(`  ${draft.data.code.length} chars → ${out}`)
for (const note of draft.data.notes) console.log(`    - ${note}`)

console.log(`\ntotal: ${draft.usage.input} in / ${draft.usage.output} out tokens, $${draft.costUsd.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)}s`)
