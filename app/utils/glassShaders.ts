import type * as THREE from 'three'
import type { MeshTransmissionMaterial } from '@pmndrs/vanilla'

/**
 * Shader patches on top of three's and drei's materials, kept apart from the studio that owns
 * them. Each patch chains the material's existing `onBeforeCompile` and shares its uniforms by
 * reference, so the studio tunes them per frame without recompiling.
 */

/** Procedural weave bump: strength (0..1) and cells per millimetre. */
export interface WeaveUniforms {
  weaveStrength: { value: number }
  weaveFreq: { value: number }
}

/** Fake total internal reflection and thin-film rim colour on the transmission material. */
export interface TirUniforms {
  tirStrength: { value: number }
  tirPower: { value: number }
  rimChroma: { value: number }
}

/**
 * A woven bump computed in the shader from the object-space position, so every part of the
 * surface gets the same cell size whatever the texture coordinates did (the projected photo's
 * pixels stretch where a camera saw the surface at an angle; this does not). Two thread
 * directions over and under in a checker, as the reference's fabric canvas, bump-mapped by
 * screen derivatives, blended across the three axes by the normal, and faded out once a cell
 * is under two pixels so a far view does not shimmer.
 */
export function patchWeave(m: THREE.MeshPhysicalMaterial, u: WeaveUniforms): void {
  const inner = m.onBeforeCompile
  const innerKey = m.customProgramCacheKey
  m.onBeforeCompile = (shader, renderer) => {
    inner.call(m, shader, renderer)
    shader.uniforms.weaveStrength = u.weaveStrength
    shader.uniforms.weaveFreq = u.weaveFreq
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeavePos; varying vec3 vWeaveNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeavePos = position; vWeaveNrm = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float weaveStrength; uniform float weaveFreq;
        varying vec3 vWeavePos; varying vec3 vWeaveNrm;
        float weaveH( vec2 q ) {
          vec2 c = floor( q );
          float over = mod( c.x + c.y, 2.0 );
          vec2 f = fract( q );
          float t = over > 0.5 ? sin( f.x * 3.14159 ) : sin( f.y * 3.14159 );
          return t * ( 0.7 + 0.3 * over );
        }
        vec3 weaveNormal( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
          vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
          vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
          vec3 vN = surf_norm;
          vec3 R1 = cross( vSigmaY, vN );
          vec3 R2 = cross( vN, vSigmaX );
          float fDet = dot( vSigmaX, R1 ) * faceDirection;
          vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
          return normalize( abs( fDet ) * surf_norm - vGrad );
        }`)
      .replace('#include <emissivemap_fragment>', `
        if ( weaveStrength > 0.0 ) {
          vec3 wp = vWeavePos * weaveFreq;
          vec3 an = abs( normalize( vWeaveNrm ) );
          an /= max( an.x + an.y + an.z, 1e-4 );
          float wh = weaveH( wp.xy ) * an.z + weaveH( wp.zy ) * an.x + weaveH( wp.xz ) * an.y;
          float cellsPerPx = max( fwidth( wp.x ), max( fwidth( wp.y ), fwidth( wp.z ) ) );
          float fade = 1.0 - smoothstep( 0.25, 0.5, cellsPerPx );
          float k = 0.35 * weaveStrength * fade;
          if ( k > 0.0 ) normal = weaveNormal( - vViewPosition, normal, vec2( dFdx( wh ), dFdy( wh ) ) * k, faceDirection );
        }
        #include <emissivemap_fragment>`)
  }
  m.customProgramCacheKey = () => (innerKey ? innerKey.call(m) : '') + '+weave'
}

/**
 * Screen-space refraction can only show what is behind the glass, so rims that should go
 * dark through total internal reflection stay white. Blend the transmitted light toward the
 * environment reflection as the view angle grazes the surface, which is where TIR happens.
 */
export function patchTotalInternalReflection(m: MeshTransmissionMaterial, u: TirUniforms): void {
  const inner = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    inner.call(m, shader, renderer)
    shader.uniforms.tirStrength = u.tirStrength
    shader.uniforms.tirPower = u.tirPower
    shader.uniforms.rimChroma = u.rimChroma
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float chromaticAberration;', 'uniform float chromaticAberration;\nuniform float tirStrength;\nuniform float tirPower;\nuniform float rimChroma;')
      .replace(
        'totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );',
        `{
          float grazing = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), tirPower );
          float tir = saturate( grazing * tirStrength );
          #ifdef USE_ENVMAP
            vec3 tirRadiance = getIBLRadiance( geometryViewDir, normal, material.roughness ) * envMapIntensity;
          #else
            vec3 tirRadiance = vec3( 0.0 );
          #endif
          transmission.rgb = mix( transmission.rgb, tirRadiance, tir );
          // Thin-film rainbow on the rims: the hue turns with the view angle and drifts across
          // the surface, so a holographic glass shimmers as it rotates. Quadratic in the
          // strength so a touch of it stays a touch; at 1 it is the whole look.
          float chroma = rimChroma * rimChroma * smoothstep( 0.0, 0.9, grazing );
          float hue = grazing * 1.6 + dot( normal, vec3( 0.35, 0.55, 0.2 ) ) * 0.6 + vWorldPosition.y * 0.004;
          vec3 spectrum = 0.55 + 0.45 * cos( 6.28318 * ( hue + vec3( 0.0, 0.33, 0.67 ) ) );
          transmission.rgb = mix( transmission.rgb, transmission.rgb * spectrum * 1.35 + spectrum * 0.08, chroma );
          totalSpecular *= mix( vec3( 1.0 ), spectrum * 1.6, chroma );
        }
        totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );`,
      )
  }
  m.customProgramCacheKey = () => 'glass-tir'
}
