# Court Rush

*Made for the love of tennis. Free for everyone, always.*

Court Rush is a free browser tennis game for anyone who enjoys the sport: a 3D,
broadcast-style singles match against a CPU opponent on clay, grass or hard
courts, in a stadium or at a country club, with tournaments and a two-voice
commentary booth. No ads, no purchases, no accounts and no tracking: settings
and tournament progress stay in your own browser. It's built on the generosity
of others (motion capture shared by researchers, open body models, open-source
voices and code; see Credits), and its own code is open source under the MIT
License, so anyone can learn from it or build on it.

Built with Vite, vanilla JavaScript and Three.js.

```bash
npm install
npm run dev      # play at the printed URL
npm test         # headless rules test, no rendering
npm run tune     # difficulty report: scripted players against each CPU level
npm run build    # static build in dist/
```

## Line judges

Ten line judges, the same at both ends: three behind each baseline and one on each sideline in each half. Balls past a baseline are called by that end's baseline judges, wide balls by the sideline judge for that half and side. When a ball is called out (or a serve a fault), the judge for that line throws an arm straight out toward where the ball went as the call is shouted; on a close ball called good, they give the "safe" sign, both arms low in front, palms down.

## Ball kids

Six ball kids, built from the same bodies and clothes as the players, in orange and navy: two crouched by the net posts and two standing at the back corners at each end. When a point or a fault ends, the dead ball keeps rolling while the server takes a fresh one; the nearest kid runs out (round the net post if the ball is on the other side of the net), crouches, picks it up and runs back with it. Before each point a corner kid at the server's end bounces the server a ball. Balls that fly into the stadium stands are left to the crowd; at the club every ball stays inside the fences, so every ball gets fetched.

## Landing marker

When the CPU hits, a marker on your side of the court shows exactly where the ball will bounce (worked out with the game's own ball physics, net cords included), and an outer ring closes in as the bounce gets near. It only shows for balls coming to you. Turn it on or off on the pause screen.

## Courts

Pick Clay, Grass or Hard court on the start screen. Clay is slow with a high bounce and long slides; grass is fast and low, with shorter slides; hard courts sit in between, with short skids and squeaking shoes. Bounces, slides and stops sound different on each.

Pick the venue too. **Stadium** is the show court: a big hall with packed stands, sponsor boards and a TV camera. **Country club** is an outdoor club court: chain-link fencing with a green windscreen, small aluminium bleachers either side, people standing along the fence, trees swaying all round, a clubhouse with a lunch terrace, flags in the breeze, people strolling on the paths and a club rally going on at the next court. It sounds different as well: open air with little echo, a smaller crowd, birdsong and the faint pock of the next court's rally. At both venues the spectators are the same MakeHuman bodies as the players, simplified to 800 triangles each (`tools/build-crowd.mjs`, using meshoptimizer), with their own clothes, skin and hair colours. They sit back or lean forward between points, clap after good points and get up on their feet, arms in the air, for the big ones.

## Career

Pick **Career** on the start screen to live a whole career, from a 14-year-old at the Halvik Academy to retirement.

- **Juniors (14 to 17):** junior club events, Junior Opens and the four junior Crowns, with a junior ranking. Bigger events need a better ranking.
- **Eighteen:** choose your road. Turn pro (a strong junior record earns wildcards into bigger events), or go to college (coming next). You can also turn pro early, from 16, against your coach's advice.
- **Pro (18 to retirement):** the Circuit, the Contender Series, the Tour and the four Crowns, with a world ranking. Retire from 30; at 36 the body decides.
- **The world:** about 190 invented players who age, improve, peak, decline and retire, and a new generation of juniors every season. Rankings count the last twelve weeks; the rest of each week is simulated.
- **Story:** your coach Rosa Halvik, a rival from your own age group who follows you all the way, and an agent once you turn pro. Your choices (your ambition, how you treat the rival, how you handle a slump) change what they say later.
- **Every event looks different:** hard courts in blue, green, purple or teal; day, golden evening or floodlit night sessions; the stadium's walls, stands and banner in the event's colours; the club's windscreen colour and trees that follow the season (blossom early in the year, autumn colours late); and stands that fill up with the size of the event, from a few dozen at a junior club event to packed for a Crown. The four Crowns keep their own signature looks (Porto Velano in terracotta by day, Ashbridge on grass, Harbour City under the floodlights, Meridian Bay at sunset), in Tournament mode too.
- **Each match:** play it, or simulate it. Opponents play to their rating, so a 14-year-old's first opponents are gentler than Easy and the world's best are tougher than Hard. Opponent strength (Easy, Normal or Hard) and match length are chosen when the career starts.
- **Saving:** the career saves itself on this device. Export it to a file from the Your career page to keep a backup or move it to another device. Quitting a match counts as a loss.

Still to come: college tennis as the alternative road at 18, and player attributes (serve, power, speed, stamina) that grow with training and age and change how you play.

## Your player

Customise player, on the start screen, opens a panel with a close-up of your player: name, body (male or female), shirt, shorts, shoes, headwear, skin tone, hair colour and hair style. Choices are saved on the device. Each match the CPU gets an invented name (never a real player's) and an outfit that does not clash with yours.

## Controls

- Move: arrows or WASD. The direction held at contact aims the shot.
- Space: drive (an overhead smash on a high ball). K: slice. L: lob.
- Power: hold the shot key to charge (the meter fills in about 0.8 s), release to swing; the swing starts on release, so time the release. A tap plays a normal shot. More power hits up to about 18% faster but spreads the errors (direction, depth, the net), much less so with perfect timing; you move slower while charging. Serve: hold the key through the toss and release at the top for a big serve (pressing twice still works, at normal power). Lobs and drop volleys are touch shots and ignore power.
- Forehand or backhand (two-handed) is picked from which side the ball arrives on.
- At the net (inside about 8.5 m), a ball that has not bounced is volleyed. Space volleys, K plays a drop volley.
- Sliding happens only at the end of a real chase: swinging after running flat out slides into the shot, and braking out of a long sprint slides to a stop. Short moves and reversals stop on your feet.
- Diving: swing at a ball that is about to pass just beyond your reach and you dive for it. It gets the ball back, but only as a short, weak shot, and you are on the ground for about a second. The CPU dives too, more willingly on harder levels.
- Line calls and challenges: on a ball within a few centimetres of a line, the line judge sometimes gets it wrong. Press C right after any line call you disagree with (a CHALLENGE button also pops up after close calls, the ones that may be wrong): an 'out' on your shot during the pause after it, or a ball of your opponent's called good straight away (play stops). Ball tracking shows the mark against the line. An overturned 'out' replays the point; a ball that was really out wins you the point; if you stopped play and the call stands, you lose the point. You have 3 unsuccessful challenges per match. If there is nothing to challenge, it is too late, or you have none left, a message says so. The CPU challenges too.
- Stamina: the bar under each name on the scoreboard. Sprinting, sliding, diving, big shots and serves use it; standing still, the breaks between points and each change of ends after a game bring it back. Below about 60% a player gets gradually slower, accelerates less and hits softer and less accurately (green, then yellow, then red). Tired players slump and breathe hard, and a spent one rests hands on knees between points. Easy CPUs tire fastest, Hard ones slowest.
- Mistimed shots can fly low and clip the tape: a net cord may trickle over or drop back. A serve that clips the net and lands in the box is a let and is replayed.
- Serve: press once to toss, again near the top of the toss.
- Match statistics show on the pause screen and when the match ends: points won, aces, double faults, first serve percentage, points won on first and second serve, fastest serve, break points, winners, unforced and forced errors, net points, distance run, dives, challenges, longest rally and match time. An error counts as forced when it was played diving, sliding or at full stretch.
- Modes: Exhibition (a single match on the court you pick) or Tournament: an eight-player knockout draw at one of three invented events (Porto Velano Open on clay, Ashbridge Lawn Championships on grass, Harbour City Masters on hard court) against seven seeded CPU opponents with invented names. Win the quarter-final, semi-final and final; the final is played one difficulty level up. The rest of the draw is simulated, the bracket shows on the menu, and progress is saved on the device so a tournament can be continued later (or abandoned). Match length: short (first to 3 games) or standard (first to 6), win by 2.
- Commentary: a two-person booth. The play-by-play voice calls the moment and the analyst follows up, sometimes with a reply: an opening (the round in tournaments and a preview of the surface), aces, double faults, winners (volleys and smashes too), long rallies, errors (long, wide, into the net), net cords, dives, big serves, break points (converted or saved), breaks of serve, deuce, runs of games, score summaries after games ("Four games to two" with a reaction), match and championship points, challenges and their verdicts, tired players, a little chat while a server takes their time, and the end of the match. They talk between points, finish their sentence and fall quiet when the next serve is struck, never talk over the umpire, and never use names, so they work with any player name. V (or the pause screen) turns commentary on or off.
- P or Esc pauses. The game also pauses when the tab loses focus. M turns sound on or off.
- Touch devices get a stick and HIT, SLICE, LOB buttons.

## Code

| Module | What it does |
| --- | --- |
| `src/config.js` | Every tuning number, including CPU difficulty levels |
| `src/scene.js` | Court, net, stadium, lighting, camera, ball view |
| `src/club.js` | The country club venue |
| `src/career.js` | Career mode logic: the invented world, ageing, calendar, rankings, draws, simulation |
| `src/story.js` | The career's story: coach, rival and agent, cards and choices |
| `src/careerui.js` | The career hub screen and story cards |
| `src/themes.js` | Each event's look: court colours, time of day, venue colours, crowd size |
| `src/crowd.js` | Spectators: the player bodies baked into crowd poses and drawn instanced |
| `src/gfx.js` | Small texture and mesh helpers |
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

The player bodies are built from MakeHuman data: the hm08 base mesh, the default skeleton and skin weights, and the macro targets that shape the athletic male and female builds. All of it is CC0 1.0 (public domain), released by the MakeHuman team (makehumancommunity.org) in 2020. `tools/fetch-makehuman.sh` downloads it and `tools/build-bodies.mjs` turns it into `src/assets/body-male.json` and `body-female.json`; `src/rig.js` drives those bodies with the game's own poses. The players' T-shirt and shorts (MakeHuman's female_casualsuit02 cut, recoloured), trainers with socks (shoes05) and hair (short02, ponytail01, afro01) are MakeHuman CC0 assets from the ara3d-data npm package, fitted to each body by the same tool and slimmed by `tools/prepare-textures.py` (needs Pillow). Caps, visors, headbands, wristbands and the racket are made in code. The shirt and shorts move with simple cloth physics, run in the vertex shader on top of the skinning (`createCloth` in `src/rig.js`): the hems sit a little off the body, lag behind on damped springs when the player accelerates, stops or changes direction, trail in the wind when running, twist behind the hips and torso on strokes and turns, and ripple slightly at speed.

The players' walking, running, sprinting and backpedalling come from motion capture: takes from the Bandai Namco Research Motion Dataset by Bandai Namco Research Inc. (https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset), licensed CC BY-NC 4.0. `tools/fetch-mocap.sh` downloads the five takes used and `tools/build-mocap.mjs` (with `tools/bvh.mjs`) cuts one gait cycle from each and retargets it onto the game's pose keys, writing `src/assets/mocap.js`. Slides, the split step and side shuffles are animated in code. Because that dataset is licensed non-commercial (NC), Court Rush is a free, non-commercial game: no sales, ads or paid extras while it uses these takes.

The umpire and line judge calls ("Out!", "Fault!", "Let!", "Correction!") are short recorded clips in `src/assets/calls.js`, rendered by `tools/build-calls.py` with Piper (piper-tts 1.8), an open-source neural text-to-speech engine (GPL-3.0; the engine is only used offline to render the clips and is not part of the game), using its en-us-libritts-high voice model trained on LibriTTS by H. Zen et al. (https://www.openslr.org/60/, CC BY 4.0). They play through the game's own audio, so they work in every browser; the browser's speech voice is only a fallback. The commentary (`src/assets/commentary.js`: quick one-liners in both voices plus 47 two- and three-line exchanges and the opening and score lines, speakers 272 (play-by-play) and 314 (analyst) of the same model) is rendered the same way by `tools/build-commentary.py` and stored as MP3 (needs ffmpeg).

The strokes and the serve come from motion capture too: takes from Tennis-MoCap, "A tennis action dataset: competitive performance of Caldas-Colombia tennis players" by J. D. Pulgarin-Giraldo, S. Garcia-Vega, L. G. Melo-Betancourt, S. Ramos-Bermudez, A. M. Alvarez-Meza and G. Castellanos (https://github.com/jdpulgarin/Tennis-MoCap), licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). See also Pulgarin-Giraldo et al., "A Similarity Indicator for Differentiating Kinematic Performance Between Qualified Tennis Players", LNCS 10125, 2017. `tools/fetch-strokes.sh` downloads the six takes used (forehand, two-handed backhand, both volleys, smash, serve) and `tools/build-strokes.mjs` picks a clean repetition of each, retargets it onto the game's pose keys, works out the racket's direction from the captured wrist, and fits it to the game's swing timing, writing `src/assets/strokes.js`. That file is adapted from Tennis-MoCap and is shared under the same CC BY-SA 3.0 licence. In the game the racket arm also reaches for the ball around contact, and the racket's roll in the hand and the left hand's grip on two-handed shots come from the earlier hand-made clips. CC BY-SA allows commercial use; what it asks is credit and that adaptations of the data stay under the same licence.

## Licence

The game's code is MIT licensed; the third-party data keeps its own licence
(non-commercial for the running motion capture, share-alike for the strokes).
See `LICENSE` and the credits above.
