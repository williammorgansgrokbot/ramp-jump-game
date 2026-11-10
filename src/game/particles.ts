import * as THREE from 'three';

interface Speck {
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  size: number;
}

function softCircle(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const CONFETTI_COLORS = [0xff3b30, 0xffd60a, 0x0a84ff, 0x30d158, 0xff9f0a, 0xbf5af2, 0xffffff, 0x64d2ff];

/** Dust, sparks, and confetti. Counts stay small for older iPads. */
export class Particles {
  private readonly dust: THREE.Points;
  private readonly sparks: THREE.Points;
  private readonly confetti: THREE.InstancedMesh;
  private readonly dustState: Speck[];
  private readonly sparkState: Speck[];
  private readonly confettiState: Speck[];
  private readonly dustPos: Float32Array;
  private readonly sparkPos: Float32Array;
  private readonly dummy = new THREE.Object3D();
  private dustCursor = 0;
  private sparkCursor = 0;
  private confettiCursor = 0;

  constructor(scene: THREE.Scene, budget: number) {
    const dustCount = Math.round(budget * 1.4);
    const sparkCount = Math.round(budget * 0.7);
    const confettiCount = Math.round(budget);
    const circle = softCircle();

    this.dustPos = new Float32Array(dustCount * 3);
    this.sparkPos = new Float32Array(sparkCount * 3);
    this.dustState = fill(dustCount);
    this.sparkState = fill(sparkCount);
    this.confettiState = fill(confettiCount);
    hide(this.dustPos);
    hide(this.sparkPos);

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: circle,
        color: 0xd2b48c,
        size: 0.45,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.dust.frustumCulled = false;

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        map: circle,
        color: 0xffe08a,
        size: 0.28,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.sparks.frustumCulled = false;

    this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.26),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false }),
      confettiCount,
    );
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    const colors = new Float32Array(confettiCount * 3);
    for (let i = 0; i < confettiCount; i++) {
      const color = new THREE.Color(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      this.dummy.position.set(0, -80, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this.dummy.matrix);
    }
    this.confetti.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    scene.add(this.dust, this.sparks, this.confetti);
  }

  dustPuff(x: number, y: number, z: number, speed: number): void {
    const n = speed > 16 ? 3 : 1;
    for (let i = 0; i < n; i++) this.spawn(this.dustState, this.dustPos, this.dustCursor++, x, y, z, 0.35, 0.8, 1.2);
    this.dustCursor %= this.dustState.length;
  }

  dustBurst(x: number, y: number, z: number): void {
    const n = Math.min(16, this.dustState.length);
    for (let i = 0; i < n; i++) this.spawn(this.dustState, this.dustPos, this.dustCursor++, x, y, z, 2.4, 0.7, 2.4);
    this.dustCursor %= this.dustState.length;
  }

  sparksAt(x: number, y: number, z: number, amount: number): void {
    const n = 6 + Math.round(amount * 10);
    for (let i = 0; i < n; i++) this.spawn(this.sparkState, this.sparkPos, this.sparkCursor++, x, y, z, 2.5 + amount * 3, 0.25, 3.5);
    this.sparkCursor %= this.sparkState.length;
  }

  celebrate(x: number, y: number, z: number): void {
    const n = Math.min(36, this.confettiState.length);
    for (let i = 0; i < n; i++) {
      const index = (this.confettiCursor + i) % this.confettiState.length;
      const speck = this.confettiState[index];
      speck.life = 1.3 + Math.random() * 0.6;
      speck.max = speck.life;
      speck.vx = (Math.random() - 0.5) * 7;
      speck.vy = 4 + Math.random() * 6;
      speck.vz = (Math.random() - 0.5) * 7;
      speck.spin = Math.random() * 8;
      speck.size = 0.7 + Math.random() * 0.8;
      this.dummy.position.set(x, y + 0.5, z);
      this.dummy.scale.setScalar(speck.size);
      this.dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(index, this.dummy.matrix);
    }
    this.confettiCursor = (this.confettiCursor + n) % this.confettiState.length;
    this.confetti.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    stepPoints(this.dustState, this.dustPos, dt, 2.2);
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    stepPoints(this.sparkState, this.sparkPos, dt, 6);
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    let dirty = false;
    for (let i = 0; i < this.confettiState.length; i++) {
      const speck = this.confettiState[i];
      if (speck.life <= 0) continue;
      speck.life -= dt;
      speck.vy -= 9 * dt;
      this.confetti.getMatrixAt(i, this.dummy.matrix);
      this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);
      this.dummy.position.x += speck.vx * dt;
      this.dummy.position.y += speck.vy * dt;
      this.dummy.position.z += speck.vz * dt;
      this.dummy.rotateX(speck.spin * dt);
      this.dummy.rotateZ(speck.spin * 0.6 * dt);
      const fade = Math.max(speck.life, 0) / speck.max;
      this.dummy.scale.setScalar(speck.life > 0 ? speck.size * (0.6 + fade * 0.4) : 0.001);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this.dummy.matrix);
      dirty = true;
    }
    if (dirty) this.confetti.instanceMatrix.needsUpdate = true;
  }

  private spawn(state: Speck[], positions: Float32Array, cursor: number, x: number, y: number, z: number, spread: number, life: number, lift: number): void {
    const index = ((cursor % state.length) + state.length) % state.length;
    const speck = state[index];
    speck.life = life * (0.6 + Math.random() * 0.6);
    speck.max = speck.life;
    speck.vx = (Math.random() - 0.5) * spread;
    speck.vy = lift * (0.4 + Math.random());
    speck.vz = (Math.random() - 0.5) * spread;
    speck.spin = 0;
    speck.size = 1;
    positions[index * 3] = x + (Math.random() - 0.5) * 0.4;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
  }
}

function fill(count: number): Speck[] {
  return Array.from({ length: count }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, spin: 0, size: 1 }));
}

function hide(positions: Float32Array): void {
  for (let i = 1; i < positions.length; i += 3) positions[i] = -80;
}

function stepPoints(state: Speck[], positions: Float32Array, dt: number, gravity: number): void {
  for (let i = 0; i < state.length; i++) {
    const speck = state[i];
    if (speck.life <= 0) continue;
    speck.life -= dt;
    speck.vy -= gravity * dt;
    positions[i * 3] += speck.vx * dt;
    positions[i * 3 + 1] += speck.vy * dt;
    positions[i * 3 + 2] += speck.vz * dt;
    if (speck.life <= 0) positions[i * 3 + 1] = -80;
  }
}
