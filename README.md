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
- Diving: swing at a ball that is about to pass just beyond your reach and you dive for it. It gets the ball back, but only as a short, weak shot, and you are on the ground for about a second. The CPU dives too, more willingly on harder levels.
- Line calls and challenges: on a ball within a few centimetres of a line, the line judge sometimes gets it wrong. Press C right after any line call you disagree with (a CHALLENGE button also pops up after close calls, the ones that may be wrong): an 'out' on your shot during the pause after it, or a ball of your opponent's called good straight away (play stops). Ball tracking shows the mark against the line. An overturned 'out' replays the point; a ball that was really out wins you the point; if you stopped play and the call stands, you lose the point. You have 3 unsuccessful challenges per match. If there is nothing to challenge, it is too late, or you have none left, a message says so. The CPU challenges too.
- Stamina: the bar under each name on the scoreboard. Sprinting, sliding, diving, big shots and serves use it; standing still, the breaks between points and each change of ends after a game bring it back. Below about 60% a player gets gradually slower, accelerates less and hits softer and less accurately (green, then yellow, then red). Tired players slump and breathe hard, and a spent one rests hands on knees between points. Easy CPUs tire fastest, Hard ones slowest.
- Mistimed shots can fly low and clip the tape: a net cord may trickle over or drop back. A serve that clips the net and lands in the box is a let and is replayed.
- Serve: press once to toss, again near the top of the toss.
- Match statistics show on the pause screen and when the match ends: points won, aces, double faults, first serve percentage, points won on first and second serve, fastest serve, break points, winners, unforced and forced errors, net points, distance run, dives, challenges, longest rally and match time. An error counts as forced when it was played diving, sliding or at full stretch.
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

The players' walking, running, sprinting and backpedalling come from motion capture: takes from the Bandai Namco Research Motion Dataset by Bandai Namco Research Inc. (https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset), licensed CC BY-NC 4.0. `tools/fetch-mocap.sh` downloads the five takes used and `tools/build-mocap.mjs` (with `tools/bvh.mjs`) cuts one gait cycle from each and retargets it onto the game's pose keys, writing `src/assets/mocap.js`. Slides, the split step and side shuffles are animated in code.

The strokes and the serve come from motion capture too: takes from Tennis-MoCap, "A tennis action dataset: competitive performance of Caldas-Colombia tennis players" by J. D. Pulgarin-Giraldo, S. Garcia-Vega, L. G. Melo-Betancourt, S. Ramos-Bermudez, A. M. Alvarez-Meza and G. Castellanos (https://github.com/jdpulgarin/Tennis-MoCap), licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). See also Pulgarin-Giraldo et al., "A Similarity Indicator for Differentiating Kinematic Performance Between Qualified Tennis Players", LNCS 10125, 2017. `tools/fetch-strokes.sh` downloads the six takes used (forehand, two-handed backhand, both volleys, smash, serve) and `tools/build-strokes.mjs` picks a clean repetition of each, retargets it onto the game's pose keys, works out the racket's direction from the captured wrist, and fits it to the game's swing timing, writing `src/assets/strokes.js`. That file is adapted from Tennis-MoCap and is shared under the same CC BY-SA 3.0 licence. In the game the racket arm also reaches for the ball around contact, and the racket's roll in the hand and the left hand's grip on two-handed shots come from the earlier hand-made clips. Because of that licence, Court Rush is a free, non-commercial game: no sales, ads or paid extras while it uses this data.
