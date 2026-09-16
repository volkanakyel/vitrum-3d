import * as THREE from 'three';

/**
 * Procedural reconstruction of a red-orange fabric chair bed (IKEA-style):
 * backrest cushion resting on a deep seat cushion over a folded mattress
 * base block, red tubular sled rail, and side straps with buttons.
 *
 * Reconstruction-by-code from a single reference image — geometry, textures
 * and materials are all generated at runtime. No external assets.
 */

export type ProceduralModelOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
};

export type SculptRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, { type: string; node: string }>;
  destructionGroups: Record<string, string[]>;
};

/* ---------------------------------------------------------------- utils */

// deterministic seeded PRNG (mulberry32) — stable across runs
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function canvasTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  srgb: boolean,
  repeat = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------- fabric texture maps */

/**
 * Woven upholstery maps. Reference-derived palette (extract_reference_pbr):
 * dominant #FB4534, secondary #FD513E/#FC634C/#E8352A, cavity #A21414.
 * Independent channels: albedo (weave mottle), roughness (inverse weave),
 * bump (crosshatch weave height). Macro band comes from vertex bulge,
 * meso from the seam creases drawn per-part, micro from the weave itself.
 */
function buildFabricMaps(size: number, seed: number) {
  const rand = mulberry32(seed);
  const [albedoCanvas, a] = makeCanvas(size);
  const [roughCanvas, r] = makeCanvas(size);
  const [bumpCanvas, b] = makeCanvas(size);

  a.fillStyle = '#fb4a30';
  a.fillRect(0, 0, size, size);
  r.fillStyle = '#e0e0e0'; // roughness base 0.88
  r.fillRect(0, 0, size, size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);

  // weave: two thread directions, cell ~ size/180 => visible only close-up
  const cell = Math.max(3, Math.round(size / 180));
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const over = ((x / cell) + (y / cell)) % 2 === 0;
      const jitter = (rand() - 0.5) * 14;
      const l = over ? 4 + jitter : -6 + jitter;
      a.fillStyle = `rgba(${l > 0 ? 255 : 120},${l > 0 ? 105 : 20},${l > 0 ? 80 : 12},${Math.min(0.22, Math.abs(l) / 60)})`;
      a.fillRect(x, y, cell, cell);
      const h = over ? 140 : 100;
      b.fillStyle = `rgb(${h},${h},${h})`;
      b.fillRect(x + (over ? 0 : 1), y + (over ? 1 : 0), cell - 1, cell - 1);
      const rg = over ? 208 : 232; // thread tops slightly glossier
      r.fillStyle = `rgb(${rg},${rg},${rg})`;
      r.fillRect(x, y, cell, cell);
    }
  }

  // macro mottle: broad soft blotches breaking flat color
  for (let i = 0; i < 60; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = size * (0.06 + rand() * 0.12);
    const g = a.createRadialGradient(x, y, 0, x, y, rad);
    const dark = rand() > 0.5;
    g.addColorStop(0, dark ? 'rgba(200,40,25,0.04)' : 'rgba(255,140,110,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g;
    a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { albedoCanvas, roughCanvas, bumpCanvas };
}

/**
 * Per-part fabric material. Seam creases are painted into the part's own
 * canvases so each part keeps independent UV-space seams (center seam,
 * fold seam) while sharing the same weave recipe.
 */
type SeamSpec = { dir: 'v' | 'h'; at: number; width: number };

function makeFabricMaterial(
  size: number,
  anisotropy: number,
  seed: number,
  seams: SeamSpec[],
  repeat: number,
): THREE.MeshStandardMaterial {
  const { albedoCanvas, roughCanvas, bumpCanvas } = buildFabricMaps(size, seed);
  const aCtx = albedoCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  for (const seam of seams) {
    const pos = seam.at * size;
    const w = seam.width * size;
    const draw = (ctx: CanvasRenderingContext2D, style: string, lw: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      if (seam.dir === 'v') {
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
      } else {
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
      }
      ctx.stroke();
    };
    // AO darkening on albedo, recessed crease on bump, rougher in crease
    draw(aCtx, 'rgba(120,14,10,0.45)', w);
    draw(aCtx, 'rgba(90,10,8,0.5)', w * 0.4);
    draw(bCtx, 'rgba(40,40,40,0.9)', w);
    draw(rCtx, 'rgba(245,245,245,0.9)', w);
    // stitch dashes alongside the crease
    aCtx.save();
    aCtx.setLineDash([size * 0.006, size * 0.006]);
    aCtx.strokeStyle = 'rgba(255,140,110,0.5)';
    aCtx.lineWidth = Math.max(1, size * 0.0015);
    aCtx.beginPath();
    if (seam.dir === 'v') {
      aCtx.moveTo(pos + w, 0);
      aCtx.lineTo(pos + w, size);
    } else {
      aCtx.moveTo(0, pos + w);
      aCtx.lineTo(size, pos + w);
    }
    aCtx.stroke();
    aCtx.restore();
  }

  return new THREE.MeshStandardMaterial({
    map: canvasTexture(albedoCanvas, anisotropy, true, repeat),
    roughnessMap: canvasTexture(roughCanvas, anisotropy, false, repeat),
    bumpMap: canvasTexture(bumpCanvas, anisotropy, false, repeat),
    bumpScale: 0.6,
    roughness: 1.0,
    metalness: 0.0,
  });
}

/* --------------------------------------------------------- geometry */

/**
 * Pillowed cushion: box with large rounded corners plus an outward sine
 * bulge on every face — reads as fabric-wrapped foam, not a hard box.
 */
function pillowBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  bulge: number,
  segments = 12,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const half = new THREE.Vector3(width / 2, height / 2, depth / 2);
  const inner = new THREE.Vector3(
    Math.max(half.x - radius, 0.001),
    Math.max(half.y - radius, 0.001),
    Math.max(half.z - radius, 0.001),
  );
  const v = new THREE.Vector3();
  const clamped = new THREE.Vector3();
  const delta = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    // round corners: clamp to inner box, push out along the remainder
    clamped.set(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z),
    );
    delta.copy(v).sub(clamped);
    if (delta.lengthSq() > 0) {
      delta.setLength(radius);
      v.copy(clamped).add(delta);
    }
    // pillow bulge: sine falloff from face centers
    const bx = Math.cos((v.y / half.y) * Math.PI * 0.5) * Math.cos((v.z / half.z) * Math.PI * 0.5);
    const by = Math.cos((v.x / half.x) * Math.PI * 0.5) * Math.cos((v.z / half.z) * Math.PI * 0.5);
    const bz = Math.cos((v.x / half.x) * Math.PI * 0.5) * Math.cos((v.y / half.y) * Math.PI * 0.5);
    v.x += Math.sign(v.x) * bulge * bx * (Math.abs(v.x) / half.x);
    v.y += Math.sign(v.y) * bulge * by * (Math.abs(v.y) / half.y);
    v.z += Math.sign(v.z) * bulge * bz * (Math.abs(v.z) / half.z);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Sled rail: front bar + two side runners, rounded corners, upturned rear tips. */
function sledRailGeometry(width: number, runnerDepth: number, tubeRadius: number): THREE.BufferGeometry {
  const hw = width / 2;
  const y = tubeRadius + 0.006;
  const z0 = runnerDepth / 2; // front
  const z1 = -runnerDepth / 2; // rear
  const corner = 0.055;
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-hw, y + 0.03, z1 - 0.06),
      new THREE.Vector3(-hw, y, z1 - 0.05),
      new THREE.Vector3(-hw, y, z1),
    ),
  );
  path.add(new THREE.LineCurve3(new THREE.Vector3(-hw, y, z1), new THREE.Vector3(-hw, y, z0 - corner)));
  path.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-hw, y, z0 - corner),
      new THREE.Vector3(-hw, y, z0),
      new THREE.Vector3(-hw + corner, y, z0),
    ),
  );
  path.add(new THREE.LineCurve3(new THREE.Vector3(-hw + corner, y, z0), new THREE.Vector3(hw - corner, y, z0)));
  path.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(hw - corner, y, z0),
      new THREE.Vector3(hw, y, z0),
      new THREE.Vector3(hw, y, z0 - corner),
    ),
  );
  path.add(new THREE.LineCurve3(new THREE.Vector3(hw, y, z0 - corner), new THREE.Vector3(hw, y, z1)));
  path.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(hw, y, z1),
      new THREE.Vector3(hw, y, z1 - 0.05),
      new THREE.Vector3(hw, y + 0.03, z1 - 0.06),
    ),
  );
  return new THREE.TubeGeometry(path, 160, tubeRadius, 16, false);
}

/* ------------------------------------------------------------ factory */

export function createOrangeChairBedModel(options: ProceduralModelOptions = {}): THREE.Group {
  const {
    castShadow = true,
    receiveShadow = true,
    textureSize = 1024,
    textureAnisotropy = 8,
  } = options;

  const root = new THREE.Group();
  root.name = 'orange-chair-bed';

  const runtime: SculptRuntime = { nodes: {}, meshes: {}, sockets: {}, colliders: {}, destructionGroups: {} };
  const node = (id: string, obj: THREE.Object3D) => {
    obj.name = id;
    runtime.nodes[id] = obj;
    return obj;
  };
  const registerMesh = (id: string, mesh: THREE.Mesh, colliderType: string) => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    runtime.meshes[id] = mesh;
    runtime.colliders[id] = { type: colliderType, node: id };
  };

  /* materials */
  const fabricSeat = makeFabricMaterial(textureSize, textureAnisotropy, 101, [{ dir: 'v', at: 0.5, width: 0.006 }], 1);
  const fabricBack = makeFabricMaterial(textureSize, textureAnisotropy, 102, [{ dir: 'v', at: 0.5, width: 0.006 }], 1);
  const fabricBase = makeFabricMaterial(textureSize, textureAnisotropy, 103, [{ dir: 'h', at: 0.52, width: 0.007 }], 1);
  const metalRed = new THREE.MeshPhysicalMaterial({
    color: '#c1271b',
    roughness: 0.3,
    metalness: 0.35,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });
  const strapRed = new THREE.MeshStandardMaterial({ color: '#c22b1c', roughness: 0.8, metalness: 0 });
  const buttonRed = new THREE.MeshStandardMaterial({ color: '#a82415', roughness: 0.5, metalness: 0 });

  /* base block — folded mattress */
  const baseBlock = new THREE.Mesh(pillowBox(0.78, 0.32, 0.72, 0.05, 0.01), fabricBase);
  node('base-block', baseBlock);
  registerMesh('base-block', baseBlock, 'box');
  baseBlock.position.set(0, 0.17, 0.02);
  root.add(baseBlock);

  /* seat cushion */
  const seatPivot = node('seat-cushion', new THREE.Object3D());
  seatPivot.position.set(0, 0.46, 0.01);
  const seatMesh = new THREE.Mesh(pillowBox(0.8, 0.26, 0.78, 0.075, 0.016), fabricSeat);
  registerMesh('seat-cushion-mesh', seatMesh, 'box');
  seatPivot.add(seatMesh);
  root.add(seatPivot);

  /* backrest cushion — pivot at its bottom edge so it can fold flat */
  const backPivot = node('backrest-cushion', new THREE.Object3D());
  backPivot.position.set(0, 0.545, -0.24); // hinge line at rear of seat
  backPivot.rotation.x = -0.17; // ~10 deg recline
  const backMesh = new THREE.Mesh(pillowBox(0.8, 0.55, 0.22, 0.085, 0.022), fabricBack);
  backMesh.position.set(0, 0.245, -0.05); // geometry above the hinge
  registerMesh('backrest-cushion-mesh', backMesh, 'box');
  backPivot.add(backMesh);
  root.add(backPivot);

  /* sled rail — glossy red bent tube under the front */
  const railGroup = node('sled-rail', new THREE.Group());
  const railMesh = new THREE.Mesh(sledRailGeometry(0.7, 0.36, 0.021), metalRed);
  registerMesh('sled-rail-mesh', railMesh, 'capsule');
  railGroup.add(railMesh);
  railGroup.position.set(0, 0, 0.22);
  root.add(railGroup);

  /* straps + buttons, mirrored */
  for (const [side, sx] of [
    ['right', 1],
    ['left', -1],
  ] as const) {
    const strapPivot = node(`strap-${side}`, new THREE.Object3D());
    // hugs the side surface across the backrest/seat junction, following the recline
    strapPivot.position.set(sx * 0.425, 0.56, -0.28);
    strapPivot.rotation.x = -0.17;
    const strapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.3, 0.06), strapRed);
    registerMesh(`strap-${side}-mesh`, strapMesh, 'box');
    strapPivot.add(strapMesh);

    for (const [bi, by] of [
      [0, 0.09],
      [1, -0.08],
    ] as const) {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.012, 24), buttonRed);
      button.rotation.z = Math.PI / 2; // axis pointing sideways out of the strap
      button.position.set(sx * 0.012, by, 0);
      registerMesh(`button-${side}-${bi}`, button, 'sphere');
      strapPivot.add(button);
      node(`button-${side}-${bi}`, button);
    }
    root.add(strapPivot);
  }

  /* sockets — attachment points for future animation/props */
  const seatSocket = node('socket-seat-top', new THREE.Object3D());
  seatSocket.position.set(0, 0.57, 0.05);
  root.add(seatSocket);
  runtime.sockets['seat-top'] = seatSocket;
  const backSocket = node('socket-backrest-hinge', new THREE.Object3D());
  backSocket.position.copy(runtime.nodes['backrest-cushion']!.position);
  root.add(backSocket);
  runtime.sockets['backrest-hinge'] = backSocket;

  runtime.destructionGroups['cushions'] = ['seat-cushion', 'backrest-cushion'];
  runtime.destructionGroups['frame'] = ['sled-rail', 'base-block'];

  root.userData.sculptRuntime = runtime;
  root.userData.reconstruction = {
    source: 'single reference image, three-quarter front-right view',
    approximations: [
      'rear and underside unseen — mirrored/assumed',
      'fabric weave and PBR response are reference-derived estimates',
    ],
  };
  return root;
}

/* ------------------------------------------------------- look-dev lights */

export function createOrangeChairBedLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'reference',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'orange-chair-bed-lights';

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2cc, mode === 'grazing' ? 0.35 : 0.9);
  lights.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, mode === 'grazing' ? 3.6 : 2.2);
  if (mode === 'grazing') key.position.set(4.0, 0.7, 2.2);
  else key.position.set(-2.2, 3.4, 2.6); // upper-front-left, as in the reference
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 1.5;
  key.shadow.camera.bottom = -1.5;
  lights.add(key);

  const fill = new THREE.DirectionalLight(0xfff4ec, 0.8);
  fill.position.set(2.4, 1.6, 2.0);
  lights.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, 2.5, -3);
  lights.add(rim);
  return lights;
}
