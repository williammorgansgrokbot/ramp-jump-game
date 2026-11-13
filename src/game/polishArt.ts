import * as THREE from 'three';

export interface PolishArt {
  water: THREE.Texture | null;
  windshield: THREE.Texture | null;
  wheelJeep: THREE.Texture | null;
  wheelMonster: THREE.Texture | null;
  boost: THREE.Texture | null;
  lip: THREE.Texture | null;
}

const NAMES = ['pond_water', 'jeep_windshield', 'wheel_jeep', 'wheel_monster', 'boost_pad', 'launch_lip'] as const;

/** art-v7, same folder layout as art-v6. Phones use the 512 set. */
export function loadPolishArt(base: string, mobile: boolean): Promise<PolishArt> {
  const size = mobile ? '512' : '1024';
  const folder = `${base}art/stunts/v7/`;
  return Promise.all(NAMES.map((name) => loadTex(`${folder}${name}_${size}.webp`, name !== 'pond_water' && name !== 'launch_lip' && name !== 'boost_pad'))).then((textures) => {
    const [water, windshield, wheelJeep, wheelMonster, boost, lip] = textures;
    if (water) {
      water.wrapS = water.wrapT = THREE.RepeatWrapping;
      water.repeat.set(6, 6);
      water.center.set(0.5, 0.5);
      water.rotation = 0.65;
    }
    if (lip) {
      lip.wrapS = THREE.RepeatWrapping;
      lip.wrapT = THREE.ClampToEdgeWrapping;
    }
    return { water, windshield, wheelJeep, wheelMonster, boost, lip };
  });
}

function loadTex(url: string, alpha: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      if (alpha) tex.premultiplyAlpha = false;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

const RIM: Record<string, THREE.Color> = {
  boy1: new THREE.Color('#e10600'),
  boy2: new THREE.Color('#1f6fe5'),
  boy3: new THREE.Color('#1f9a3a'),
  boy4: new THREE.Color('#f0c410'),
};

/** Recolor the red rim in the wheel picture. The tire and the holes stay put. */
export function rimMaterial(map: THREE.Texture, id: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    alphaTest: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const rim = RIM[id] ?? RIM.boy1;
  const token = `RIM_${id}`;
  material.customProgramCacheKey = () => token;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rim };
    shader.fragmentShader = `uniform vec3 rimColor;\n#define ${token}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float redness = diffuseColor.r - max(diffuseColor.g, diffuseColor.b);
       float rimMix = smoothstep(0.05, 0.22, redness);
       float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       vec3 tinted = rimColor * clamp(luma * 2.15, 0.28, 1.25);
       diffuseColor.rgb = mix(diffuseColor.rgb, tinted, rimMix);`,
    );
  };
  return material;
}
