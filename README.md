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

## Controls

- Move: arrows or WASD. The direction held at contact aims the shot.
- Space: drive (an overhead smash on a high ball). K: slice. L: lob.
- Forehand or backhand (two-handed) is picked from which side the ball arrives on.
- At the net (inside about 8.5 m), a ball that has not bounced is volleyed. Space volleys, K plays a drop volley.
- Sliding happens only at the end of a real chase: swinging after running flat out slides into the shot, and braking out of a long sprint slides to a stop. Short moves and reversals stop on your feet.
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
