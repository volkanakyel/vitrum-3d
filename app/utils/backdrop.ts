import * as THREE from 'three'
import type { BackdropFill, GlassParams } from './presets'

/**
 * The wall behind the model, painted per pixel: a solid colour, a linear blend or a radial glow,
 * darkened toward the corners. A shader instead of a canvas texture because the plane is three
 * views wide (it must still cover the frame while the camera orbits), so a texture would spend
 * two thirds of its pixels off screen and blur the third that shows.
 *
 * Positions are in "view heights": the visible frame spans y −0.5..0.5 and x ±aspect/2, so a
 * gradient runs corner to corner of what is on screen whatever the stage's shape. Colours mix in
 * sRGB, as CSS does, so a swatch in the panel previews the stage exactly, and a little noise
 * dithers the 8-bit output so a long, pale blend never bands.
 */
export type BackdropUniforms = {
  colorA: { value: THREE.Color }
  colorB: { value: THREE.Color }
  fill: { value: number }
  angle: { value: number }
  vignette: { value: number }
  aspect: { value: number }
  planeAspect: { value: number }
}

const FILLS: Record<BackdropFill, number> = { solid: 0, linear: 1, radial: 2 }

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform int fill;
  uniform float angle;
  uniform float vignette;
  uniform float aspect;
  uniform float planeAspect;
  varying vec2 vUv;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // The plane is 3 view heights tall and 3 × planeAspect wide.
    vec2 p = vec2((vUv.x - 0.5) * 3.0 * planeAspect, (vUv.y - 0.5) * 3.0);
    float halfDiag = 0.5 * sqrt(aspect * aspect + 1.0);
    vec3 c = colorA;
    if (fill == 1) {
      // CSS angles: 0deg points up, 90deg right; the blend spans the frame along that line.
      vec2 dir = vec2(sin(angle), cos(angle));
      float span = abs(dir.x) * aspect + abs(dir.y);
      c = mix(colorA, colorB, clamp(dot(p, dir) / span + 0.5, 0.0, 1.0));
    } else if (fill == 2) {
      float t = length(p - vec2(0.0, 0.04)) / halfDiag;
      c = mix(colorA, colorB, smoothstep(0.0, 0.92, t));
    }
    float d = length(p) / halfDiag;
    c *= 1.0 - vignette * 0.32 * smoothstep(0.3, 1.1, d);
    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(srgbToLinear(clamp(c, 0.0, 1.0)), 1.0);
    #include <colorspace_fragment>
  }
`

export function createBackdropMaterial(): { material: THREE.ShaderMaterial; uniforms: BackdropUniforms } {
  const uniforms: BackdropUniforms = {
    colorA: { value: new THREE.Color() },
    colorB: { value: new THREE.Color() },
    fill: { value: 0 },
    angle: { value: Math.PI },
    vignette: { value: 0 },
    aspect: { value: 1 },
    planeAspect: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, toneMapped: false, depthWrite: false })
  return { material, uniforms }
}

/** Push the backdrop parameters; colours go in as raw sRGB so the shader mixes them like CSS. */
export function paintBackdrop(u: BackdropUniforms, p: GlassParams): void {
  u.colorA.value.setStyle(p.background, THREE.NoColorSpace)
  u.colorB.value.setStyle(p.background2, THREE.NoColorSpace)
  u.fill.value = FILLS[p.backdropFill]
  u.angle.value = THREE.MathUtils.degToRad(p.backdropAngle)
  u.vignette.value = p.vignette
}
