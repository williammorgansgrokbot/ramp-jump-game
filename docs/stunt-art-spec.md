# Stunt art spec

Color images only. Generate each one at 1024 and 512. The game loads `name_1024.webp` on desktop and `name_512.webp` on phones. No text, logos, or watermarks. Lighting is flat and even.

A normal map is never an output of the generator. Where the table says yes, derive it in code from the image treated as a height field (lighter is higher). OpenGL tangent space, +Y up.

| File | Slot | Tile | Tileable | Normal from height | Prompt |
|---|---|---|---|---|---|
| `deck_red` | `deck-track` | 2 m × 2 m | both ways | yes, fine grit | Seamless top-down photo of painted red-orange steel plate with fine anti-slip grit and a few pale scuffs. |
| `loop_track` | `loop-track` | 5.5 m across, repeats every 5.5 m along | along the track only. U is one full width, 0 at the left edge and 1 at the right | yes, very shallow | Top-down strip of dark satin steel track, full width in frame. Solid white edge lines near both edges, a yellow dashed center line, and two faint darker wheel streaks. |
| `plywood_lanes` | `plywood-lanes` | 3.5 m across, repeats every 3.5 m along | along the deck only. U is one deck width | yes, wood grain | Top-down plywood deck filling the frame, grain running vertically, pale edge lines inset from both sides, and a dashed center line. |
| `diamond` | `diamond-plate` | 0.8 m × 0.8 m | both ways | yes, raised lugs | Seamless top-down diamond-plate steel. Raised lugs on a regular grid, gray metal, no paint. |
| `truss_yellow` | `steel-yellow` | 1 m × 1 m | both ways. Scratches run vertically | no | Seamless close-up of glossy safety-yellow paint with a few thin scratches running vertically. |
| `truss_blue` | `steel-blue` | 1 m × 1 m | both ways. Scratches run vertically | no | Seamless close-up of glossy royal-blue paint with a few thin scratches running vertically. |
| `chevron_yellow_black` | `hazard-chevron` | 2 m wide × 0.5 m tall | along the width only | no | Flat yellow and black upward chevrons, equal bands, one repeat across the width, filling the frame. |
| `hazard_red_white` | `hazard-edge` | 2 m wide × 0.5 m tall | along the width only | no | Flat red and white diagonal hazard stripes at 45 degrees, equal bands, filling the frame. |
| `shell_steel` | `shell-steel` | 1.25 m × 1.25 m | both ways | yes, panel seams | Seamless top-down satin light-gray painted steel sheet with faint rectangular panel seams. |

These stay procedural and need no image: `deck-stripe`, `rail-wall`, `coping-pipe`, `bumper-pad`, `contact-ao`, `contact-footprint`.
