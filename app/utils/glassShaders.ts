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
  /** The Liquid finish (0..1): spectral refraction, rims split by wavelength, film grain. */
  liquid: { value: number }
  /** Liquid only: the IOR spread from red to violet, as a share of the IOR. */
  spectralSpread: { value: number }
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
    shader.uniforms.liquid = u.liquid
    shader.uniforms.spectralSpread = u.spectralSpread
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float chromaticAberration;', 'uniform float chromaticAberration;\nuniform float tirStrength;\nuniform float tirPower;\nuniform float rimChroma;\nuniform float liquid;\nuniform float spectralSpread;')
      .replace(
        'totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );',
        `{
          float grazing = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), tirPower );
          float tir = saturate( grazing * tirStrength );
          // Liquid splits light by wavelength only at the edges, as a prism does: across the flat
          // front and back the shift would only tint the whole face. The model is built along
          // its z axis, so the object-space normal turning away from z finds the bevels and
          // walls (the bevels are faceted, so the normal's change per pixel cannot); grazing
          // finds the silhouette whatever the pose.
          vec3 nObj = normalize( transpose( mat3( modelMatrix ) ) * inverseTransformDirection( normal, viewMatrix ) );
          float edge = max( smoothstep( 0.1, 0.5, 1.0 - abs( nObj.z ) ), smoothstep( 0.25, 0.75, grazing ) );
          // The way the normal leans away from the eye, as long as the lean is steep: bending the
          // normal either way along it splits a reflection by wavelength across the rim.
          vec3 lean = ( normal - geometryViewDir * dot( normal, geometryViewDir ) ) * edge;
          #ifdef USE_ENVMAP
            vec3 tirRadiance = getIBLRadiance( geometryViewDir, normal, material.roughness ) * envMapIntensity;
            if ( liquid > 0.0 ) {
              // Liquid: the rim mirrors the strip lights with red and blue pulled apart, so every
              // bright streak on an edge carries a warm side and a cool side.
              float s = spectralSpread * 1.5;
              vec3 split = vec3(
                getIBLRadiance( geometryViewDir, normalize( normal - lean * s ), material.roughness ).r,
                tirRadiance.g / max( envMapIntensity, 1e-4 ),
                getIBLRadiance( geometryViewDir, normalize( normal + lean * s ), material.roughness ).b
              ) * envMapIntensity;
              tirRadiance = mix( tirRadiance, split, liquid );
            }
          #else
            vec3 tirRadiance = vec3( 0.0 );
          #endif
          if ( liquid > 0.0 ) {
            // Spectral refraction: seven fixed wavelengths, each at its own IOR, each weighted by
            // its hue. Fixed taps (no jitter) keep the bands crisp, so a white edge seen through
            // the body breaks into clean red, green and blue outlines instead of a smear.
            vec3 vW = normalize( cameraPosition - vWorldPosition );
            vec3 nW = inverseTransformDirection( normal, viewMatrix );
            vec3 spectral = vec3( 0.0 );
            vec3 weight = vec3( 0.0 );
            for ( int k = 0; k < 7; k ++ ) {
              float w = float( k ) / 6.0;
              vec3 hue = saturate( vec3( 1.5 - abs( w * 4.0 - 0.6 ), 1.5 - abs( w * 4.0 - 2.0 ), 1.5 - abs( w * 4.0 - 3.4 ) ) );
              float kIor = material.ior * ( 1.0 + spectralSpread * ( w - 0.5 ) );
              vec3 t = getIBLVolumeRefraction(
                nW, vW, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
                vWorldPosition, modelMatrix, viewMatrix, projectionMatrix, kIor, material.thickness,
                material.attenuationColor, material.attenuationDistance
              ).rgb;
              spectral += t * hue;
              weight += hue;
            }
            transmission.rgb = mix( transmission.rgb, spectral / weight, liquid * edge );
          }
          transmission.rgb = mix( transmission.rgb, tirRadiance, tir );
          // Thin-film rainbow on the rims: the hue turns with the view angle and drifts across
          // the surface, so a holographic glass shimmers as it rotates. Quadratic in the
          // strength so a touch of it stays a touch; at 1 it is the whole look.
          float chroma = rimChroma * rimChroma * smoothstep( 0.0, 0.9, grazing );
          float hue = grazing * 1.6 + dot( normal, vec3( 0.35, 0.55, 0.2 ) ) * 0.6 + vWorldPosition.y * 0.004;
          vec3 spectrum = 0.55 + 0.45 * cos( 6.28318 * ( hue + vec3( 0.0, 0.33, 0.67 ) ) );
          transmission.rgb = mix( transmission.rgb, transmission.rgb * spectrum * 1.35 + spectrum * 0.08, chroma );
          totalSpecular *= mix( vec3( 1.0 ), spectrum * 1.6, chroma );
          // Film grain over the body, as a liquid-glass render carries in its dark passages. Fixed
          // to the pixel so it reads as the print's grain, not as noise crawling over the glass.
          if ( liquid > 0.0 ) {
            float g = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
            transmission.rgb += g * 0.035 * liquid * ( 0.35 + 0.65 * smoothstep( 0.6, 0.0, dot( transmission.rgb, vec3( 0.333 ) ) ) );
          }
        }
        totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );`,
      )
  }
  m.customProgramCacheKey = () => 'glass-tir'
}
