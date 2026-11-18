# Court Rush

Browser tennis: a 3D, broadcast-style singles match against a CPU opponent.
Vite, vanilla JavaScript, and Three.js. Everything (textures, figures, sounds)
is generated in code.

```bash
npm install
npm run dev      # play at the printed URL
npm test         # headless rules test, no rendering
npm run tune     # difficulty report: scripted players against each CPU level
npm run build    # static build in dist/
```

## Courts

Pick Clay, Grass or Hard court on the start screen. Clay is slow with a high bounce and long slides; grass is fast and low, with shorter slides; hard courts sit in between, with short skids and squeaking shoes. Bounces, slides and stops sound different on each.

## Your player

Customise player, on the start screen, opens a panel with a close-up of your player: name, body (male or female), shirt, shorts, shoes, headwear, skin tone, hair colour and hair style. Choices are saved on the device. Each match the CPU gets an invented name (never a real player's) and an outfit that does not clash with yours.

## Controls

- Move: arrows or WASD. The direction held at contact aims the shot.
- Space: drive (an overhead smash on a high ball). K: slice. L: lob.
- Forehand or backhand (two-handed) is picked from which side the ball arrives on.
- At the net (inside about 8.5 m), a ball that has not bounced is volleyed. Space volleys, K plays a drop volley.
- Sliding happens only at the end of a real chase: swinging after running flat out slides into the shot, and braking out of a long sprint slides to a stop. Short moves and reversals stop on your feet.
- Mistimed shots can fly low and clip the tape: a net cord may trickle over or drop back. A serve that clips the net and lands in the box is a let and is replayed.
- Serve: press once to toss, again near the top of the toss.
- P or Esc pauses. The game also pauses when the tab loses focus. M turns sound on or off.
- Touch devices get a stick and HIT, SLICE, LOB buttons.

## Code

| Module | What it does |
| --- | --- |
| `src/config.js` | Every tuning number, including CPU difficulty levels |
| `src/scene.js` | Court, net, arena, lighting, camera, ball view |
| `src/human.js` | Figure builder and procedural animation behind `setPose` / `update` |
| `src/ball.js` | Fixed-step ball physics and shot planning |
| `src/rules.js` | Court tests and scoring |
| `src/ai.js` | CPU opponent |
| `src/input.js` | Keyboard and touch |
| `src/hud.js` | Scoreboard, messages, start screen |
| `src/audio.js` | Match sound: ball strikes, bounces, net, slides, stadium reverb, crowd bed and applause |
| `src/soundgen.js` | Builds the crowd bed, applause, whistles and reverb as sample buffers at startup |
| `src/main.js` | Headless game core (`createGame`) and the browser loop |
| `test/` | Scripted player, rules test, difficulty report |

## Credits

The player bodies are built from MakeHuman data: the hm08 base mesh, the default skeleton and skin weights, and the macro targets that shape the athletic male and female builds. All of it is CC0 1.0 (public domain), released by the MakeHuman team (makehumancommunity.org) in 2020. `tools/fetch-makehuman.sh` downloads it and `tools/build-bodies.mjs` turns it into `src/assets/body-male.json` and `body-female.json`; `src/rig.js` drives those bodies with the game's own poses. The players' T-shirt and shorts (MakeHuman's female_casualsuit02 cut, recoloured), trainers with socks (shoes05) and hair (short02, ponytail01, afro01) are MakeHuman CC0 assets from the ara3d-data npm package, fitted to each body by the same tool and slimmed by `tools/prepare-textures.py` (needs Pillow). Caps, visors, headbands, wristbands and the racket are made in code.
