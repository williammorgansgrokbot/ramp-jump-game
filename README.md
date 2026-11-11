# Ramp Jump

A kid-friendly 3D ramp-jump car toy for iPhone and iPad. Open it in Safari, then **Share → Add to Home Screen**. It plays full screen, with no accounts, ads, or network calls after the first load.

Phase 1 is one bright toy car, a long runway, one giant launch ramp, and a soft landing field. The car has suspension, flips in the air, crumples on impact, and pops bumpers, doors, hood, spoiler, and wheels off as separate pieces. Stars and confetti replace any damage score.

Live site (after GitHub Pages is enabled): <https://williammorgansgrokbot.github.io/ramp-jump-game/>

## Play

Landscape is best. Portrait works too.

- Big green button: hold to drive
- Yellow arrows: steer
- Phone icon: tilt steering. On iPhone, the first tap asks for motion permission
- Orange arrow: instant restart, car back at the start, dents gone
- Four boys: Wyatt (red), Reid (blue), Brady (green), and Stetson (yellow). Each name is on his color button, on the vehicle, and spoken when a round starts.

## For parents

1. Open the Pages URL in Safari on the iPhone or iPad.
2. Tap Share, then **Add to Home Screen**.
3. Launch the icon. The first drive tap turns sound on. That is required by iOS.
4. The game stores nothing and does not link anywhere.

## Tech

- [Vite](https://vitejs.dev/) static build, base path `/ramp-jump-game/`
- [Three.js](https://threejs.org/) WebGL2, with an optional WebGPU renderer when `navigator.gpu` exists (or `?webgpu=1`). If WebGPU fails to start, it falls back to WebGL2. Bloom runs on the WebGL2 path.
- [Rapier](https://rapier.rs/) WASM (`@dimforge/rapier3d-compat`, inlined so GitHub Pages does not need a `.wasm` MIME type) with a raycast vehicle: suspension, engine force, steering. Forward axis is set with Rapier's `setIndexForwardAxis` property.
- Impact crumple moves shell vertices near the contact. Parts that pass a speed threshold become their own rigid bodies.
- The sky is Bill's equirectangular sea panorama (WebP). Phones use the 2048 version and desktop the 4096. Reflections are a PMREM of that panorama, and the sun follows its brightest point. Grass, asphalt, dirt, sand, and the wooden ramp are tiled photos with a slow brightness variation so the repeat is less obvious. Trees are one camera-facing atlas. UI buttons, stars, car pictures, and the home-screen icon are from the same art pack (`art/manifest.json`, ComfyUI). The car shell is still procedural so parts can detach. Sounds are synthesized in WebAudio.
- Older phones and iPads start at a lower pixel ratio and shadow map. If the frame rate stays under about 40, bloom and resolution step down.
- PWA: `display: fullscreen` (browsers that cannot do fullscreen use standalone), apple touch icon, safe-area insets, no pinch-zoom or scroll.

## Phase 2 hooks

- `src/game/catalog.ts` — `CARS` (Wyatt, Reid, Brady, Stetson) and `RAMPS` (`launch`, `loop`, `quarter-pipe`, `gap`, `mega`). Only the launch ramp is enabled.
- `src/game/terrain.ts` — `heightForRamp()` builds the launch and mega profiles. The other kinds return a flat height until a builder is added.
- `src/game/carMesh.ts` — `ToyCar.setConfig()` repaints a car without rebuilding physics.

## Scripts

```bash
npm install
npm run dev      # http://127.0.0.1:5173/ramp-jump-game/
npm run sim      # headless physics: the car must jump and land hard
npm test         # Playwright, iPad landscape, iPhone landscape, iPhone portrait
npm run build    # static site in dist/
```

## Deploy

`.github/workflows/pages.yml` builds `dist/` and deploys with GitHub Actions. In the repo settings, **Pages → Build and deployment → Source** must be **GitHub Actions**.

## Known limits

This is a rigid chassis with dented visuals, not BeamNG node-and-beam soft-body. Art direction is a bright toy, not a photo-real driving sim. Headless frame rate is software WebGL and is not the iPad's frame rate; on-device rate depends on the adaptive quality steps above.
