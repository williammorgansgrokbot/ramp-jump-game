import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { barrierBoxes, LANDING, launchHeight, landingHeight, TRACK_HALF_WIDTH } from './terrain';
import { enabledLaunch } from './catalog';

export interface WorldView {
  update(dt: number): void;
}

export function buildWorld(scene: THREE.Scene): WorldView {
  scene.add(skyDome());
  scene.add(sea());
  scene.add(grass());
  scene.add(hills());
  const clouds = cloudBand();
  scene.add(clouds);

  const runway = surfaceMesh(-4, 50, 40, (z) => launchHeight(z), runwayColor, 0.9, 0.02);
  const ramp = surfaceMesh(50, 78, 48, (z) => (z >= 74 ? launchHeight(74) : launchHeight(z)), rampColor, 0.42, 0.08, 0.35);
  const landing = surfaceMesh(LANDING.z0, LANDING.z1, 70, landingHeight, landingColor, 0.55, 0.12, 0.25);
  scene.add(runway, ramp, landing);

  scene.add(dashes());
  scene.add(chevrons());
  scene.add(barriers());
  scene.add(lipChecks());
  scene.add(startArch());
  scene.add(trees());
  scene.add(edgeBulbs());

  return {
    update(dt: number) {
      clouds.position.x = Math.sin(performance.now() * 0.00004) * 6;
      clouds.rotation.y += dt * 0.01;
    },
  };
}

function skyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#2f8dff') },
      mid: { value: new THREE.Color('#8fd4ff') },
      horizon: { value: new THREE.Color('#fff1c9') },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 horizon;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
        col = mix(col, top, smoothstep(0.2, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 28, 18), material);
  mesh.frustumCulled = false;
  return mesh;
}

function grass(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(240, 64);
  geo.rotateX(-Math.PI / 2);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const n = 0.5 + 0.5 * Math.sin(x * 0.07) * Math.cos(z * 0.05);
    const color = new THREE.Color().setHSL(0.3, 0.62, 0.38 + n * 0.08);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
  );
  mesh.position.y = -0.55;
  mesh.receiveShadow = true;
  return mesh;
}

function sea(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(520, 48);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x1ec8ef, roughness: 0.12, metalness: 0.45, envMapIntensity: 1 }),
  );
  mesh.position.y = -1.35;
  return mesh;
}

function hills(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3cbe63, roughness: 0.9 });
  const spots = [
    [-110, 4, -40, 16],
    [120, 5, 60, 18],
    [-130, 4, 170, 15],
    [140, 6, 210, 18],
    [70, 3, -80, 12],
  ];
  for (const [x, y, z, r] of spots) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    hill.position.set(x, y, z);
    hill.scale.y = 0.55;
    group.add(hill);
  }
  return group;
}

function cloudBand(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Group();
    const base = 7 + (i % 3) * 2;
    for (let k = 0; k < 3; k++) {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(base * (0.7 + k * 0.15), 10, 8), mat);
      sphere.position.set((k - 1) * base * 0.7, k === 1 ? base * 0.3 : 0, 0);
      puff.add(sphere);
    }
    puff.position.set(-80 + i * 28, 38 + (i % 4) * 6, -40 + (i % 3) * 30);
    group.add(puff);
  }
  return group;
}

function surfaceMesh(
  z0: number,
  z1: number,
  steps: number,
  heightAt: (z: number) => number,
  colorAt: (x: number, z: number) => THREE.Color,
  roughness: number,
  metalness: number,
  clearcoat = 0,
): THREE.Mesh {
  const nx = 10;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const row = nx + 1;
  for (let iz = 0; iz <= steps; iz++) {
    const z = z0 + ((z1 - z0) * iz) / steps;
    const y = heightAt(z);
    for (let ix = 0; ix <= nx; ix++) {
      const x = -TRACK_HALF_WIDTH + (2 * TRACK_HALF_WIDTH * ix) / nx;
      positions.push(x, y, z);
      const color = colorAt(x, z);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let iz = 0; iz < steps; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  let up = 0;
  for (let i = 0; i < normal.count; i++) up += normal.getY(i);
  if (up < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness,
      metalness,
      clearcoat,
      clearcoatRoughness: 0.4,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

const asphalt = new THREE.Color('#3c4454');
const edge = new THREE.Color('#ffd60a');
const lane = new THREE.Color('#4a5366');

function runwayColor(x: number): THREE.Color {
  if (Math.abs(x) > 7.2) return edge;
  if (Math.abs(x) < 0.35) return lane;
  return asphalt;
}

const orange = new THREE.Color('#ff8c1a');
const chevron = new THREE.Color('#ffe14a');

function rampColor(x: number, z: number): THREE.Color {
  if (Math.abs(x) > 7.3) return new THREE.Color('#ff4d4d');
  const band = Math.floor(z) % 4 === 0;
  return band ? chevron : orange;
}

function landingColor(x: number, z: number): THREE.Color {
  const u = z - LANDING.z0;
  const palette = [0xff5d8f, 0xffe14a, 0x3dccc7, 0x7cff6b, 0x8eb6ff];
  const index = Math.abs(Math.floor(u / 12)) % palette.length;
  const color = new THREE.Color(palette[index]);
  if (Math.abs(x) > 7.4) color.offsetHSL(0, 0, -0.08);
  return color;
}

function dashes(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (let z = 2; z < 48; z += 4) {
    const dash = new THREE.BoxGeometry(0.28, 0.03, 1.5);
    dash.translate(0, 0.04, z);
    geos.push(dash);
  }
  const merged = mergeGeometries(geos);
  if (!merged) return new THREE.Mesh();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.5 }));
  mesh.receiveShadow = true;
  return mesh;
}

function chevrons(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const launch = enabledLaunch();
  for (let z = launch.z + 2; z < launch.z + launch.length - 1; z += 4) {
    const y = launchHeight(z) + 0.05;
    for (const side of [-1, 1]) {
      const chev = new THREE.BoxGeometry(1.1, 0.04, 0.28);
      chev.rotateY(side * 0.5);
      chev.translate(side * 0.7, y, z);
      geos.push(chev);
    }
  }
  const merged = mergeGeometries(geos);
  if (!merged) return new THREE.Mesh();
  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xfff3a1, roughness: 0.4, emissive: 0xffc14a, emissiveIntensity: 0.18 }));
}

function barriers(): THREE.Group {
  const group = new THREE.Group();
  for (const box of barrierBoxes()) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2),
      new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.45, metalness: 0.05 }),
    );
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    mesh.rotation.x = box.rotX;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function lipChecks(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const z = 74;
  const y = launchHeight(z) + 0.06;
  for (let i = -7; i <= 7; i++) {
    const tile = new THREE.BoxGeometry(0.7, 0.05, 0.7);
    tile.translate(i * 0.72, y, z);
    geos.push(tile);
  }
  const light: THREE.BufferGeometry[] = [];
  const darks: THREE.BufferGeometry[] = [];
  geos.forEach((geo, i) => {
    (Math.abs(i - 7) % 2 === 0 ? light : darks).push(geo);
  });
  const groupGeo = mergeGeometries(light);
  const mesh = new THREE.Mesh(
    groupGeo ?? new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  );
  if (darks.length) {
    const darkMesh = new THREE.Mesh(mergeGeometries(darks) ?? new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5 }));
    mesh.add(darkMesh);
  }
  return mesh;
}

function startArch(): THREE.Group {
  const group = new THREE.Group();
  const colors = [0xff3b30, 0xff9f0a, 0xffd60a, 0x30d158, 0x0a84ff, 0xbf5af2, 0xff375f];
  const archZ = 11;
  colors.forEach((color, i) => {
    const t = i / (colors.length - 1);
    const angle = Math.PI * (0.18 + 0.64 * t);
    const balloon = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 12),
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.6, emissive: color, emissiveIntensity: 0.05 }),
    );
    balloon.position.set(Math.cos(angle) * 3.4, 3.2 + Math.sin(angle) * 1.35, archZ);
    balloon.castShadow = true;
    group.add(balloon);
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  for (const x of [-3.2, 3.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), poleMat);
    pole.position.set(x, 1.7, archZ);
    group.add(pole);
  }
  return group;
}

function trees(): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2fbf55, roughness: 0.75 });
  const trunks: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const z = -2 + i * 10;
    for (const side of [-1, 1]) {
      const x = side * (16 + (i % 3) * 1.6);
      const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.4, 6);
      trunk.translate(x, 0.5, z);
      trunks.push(trunk);
      const leaf = new THREE.SphereGeometry(1.05, 8, 6);
      leaf.translate(x, 1.7, z);
      leaves.push(leaf);
    }
  }
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunks) ?? new THREE.BufferGeometry(), trunkMat);
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves) ?? new THREE.BufferGeometry(), leafMat);
  group.add(trunkMesh, leafMesh);
  return group;
}

function edgeBulbs(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xfff4cf, emissive: 0xffc14a, emissiveIntensity: 1.1, roughness: 0.35 });
  const launch = enabledLaunch();
  for (let z = launch.z; z <= launch.z + launch.length; z += 4) {
    const y = launchHeight(Math.min(z, launch.z + launch.length)) + 0.25;
    for (const x of [-7.6, 7.6]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat);
      bulb.position.set(x, y, z);
      group.add(bulb);
    }
  }
  return group;
}
