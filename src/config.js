// All tuning numbers live here. Units are metres, seconds, radians.

export const COURT = {
  length: 23.77,
  halfLength: 11.885,
  singlesWidth: 8.23,
  singlesHalf: 4.115,
  doublesWidth: 10.97,
  doublesHalf: 5.485,
  serviceLine: 6.4,
  netCentre: 0.914,
  netPost: 1.07,
  postX: 6.399, // 0.914 outside the doubles line
  lineWidth: 0.05,
  baselineWidth: 0.1,
};

// Net height at lateral position x (straight sag from posts to the centre strap).
export function netHeightAt(x) {
  const t = Math.min(1, Math.abs(x) / COURT.postX);
  return COURT.netCentre + (COURT.netPost - COURT.netCentre) * t;
}

export const ARENA = {
  floorWidth: 70,
  floorLength: 90,
  backWallZ: -18.6,
  backWallHeight: 5.4,
  sideWallX: 9.6,
  sideWallHeight: 1.05,
  standRows: 7,
  standRowDepth: 0.85,
  standRowRise: 0.45,
  standZMin: -18.2,
  standZMax: 16,
  seatSpacing: 0.62,
  seatFill: 0.86,
};

export const CAMERA = {
  position: [0, 10.8, 29.5],
  target: [0, 0, 4.2],
  fov: 28, // vertical, at the base aspect
  baseAspect: 16 / 9,
  maxFov: 85,
  near: 1,
  far: 140,
  panPosition: 0.16, // camera x per metre of player x
  panTarget: 0.3, // look-at x per metre of player x
  panLerp: 3.5,
};

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowHalfWidth: 17,
  shadowHalfLength: 23,
};

export const LIGHT = {
  hemiSky: 0xe6edff,
  hemiGround: 0x4a3830,
  hemiIntensity: 1.25,
  sunColor: 0xfff3e0,
  sunIntensity: 2.3,
  sunPosition: [-15, 26, 12],
};

export const COLORS = {
  background: 0x0b0e13,
  clay: '#b9573a',
  floor: '#2a2d32',
  line: 0xf4f1ea,
  wall: 0x12161d,
  wallTrim: 0x1c232e,
  stand: 0x191d24,
  post: 0x15171a,
};

// Court surfaces. Clay is slow with a high bounce and long slides; grass is fast
// and low, the ball skidding through; hard courts sit in between and players
// stop with a squeak rather than a slide.
export const SURFACES = {
  clay: {
    label: 'Clay', court: '#b9573a', floor: '#2a2d32',
    bounce: 0.74, sliceBounce: 0.6, friction: 0.8, // vertical and horizontal speed kept on a bounce
    slideDecel: 12, slideChase: 0.45, slideSprint: 0.75, // m/s^2, and seconds of chasing before a slide
    marks: true, // bounce marks, slide trails and dust
  },
  grass: {
    label: 'Grass', court: '#5f8f3a', floor: '#557f34',
    bounce: 0.64, sliceBounce: 0.5, friction: 0.9,
    slideDecel: 17, slideChase: 0.5, slideSprint: 0.9,
    marks: false,
  },
  hard: {
    label: 'Hard court', court: '#2f5d93', floor: '#36624e',
    bounce: 0.7, sliceBounce: 0.56, friction: 0.85,
    slideDecel: 22, slideChase: 0.5, slideSprint: 0.9, // short skids only
    marks: false,
  },
};
export const DEFAULT_SURFACE = 'clay';

// Body proportions for the code-built figure (about 1.85 m tall).
export const BODY = {
  thigh: 0.45,
  shin: 0.45,
  footHeight: 0.07,
  hipJointDrop: 0.02,
  hipHalfWidth: 0.095,
  torsoBase: 0.06,
  chestY: 0.2, // where the upper spine segment starts, above the torso base
  shoulderY: 0.47,
  shoulderHalfWidth: 0.205,
  upperArm: 0.3,
  foreArm: 0.27,
  headRadius: 0.115,
};

export const PLAYER = {
  speed: 6.2, // near player top speed, m/s
  // movement physics (m/s^2): first step, speeding up (fading near top speed), braking, turning grip
  accelStart: 20,
  accelRun: 18,
  accelFade: 0.55,
  brake: 26,
  turnGrip: 22,
  swingMoveFactor: 0.35, // movement speed multiplier while swinging
  startZ: 12.5,
  minZ: 1.2,
  maxZ: 16.5,
  maxX: 8.6,
  // Sliding happens only at the end of a real chase: running near top speed for a while,
  // then swinging at the ball, or braking hard out of a long sprint. Normal stops are quick.
  chaseSpeed: 0.7, // fraction of top speed that counts as chasing
  slideTrigger: 0.3, // braking: wanted speed along the run below this fraction of speed
  slideReverseLimit: 0.3, // wanting to go back the other way: plant and push off, no slide
  // the slide's deceleration and the chase times come from the court: see SURFACES
  slideDecelReverse: 24, // m/s^2 when pushing back the other way mid-slide
  slideEndSpeed: 0.8,
  plantSpeed: 4.2, // reversing direction from above this speed plants the foot (a squeak on hard courts)
  plantGap: 1.5, // seconds between plants for one player
  splitMaxSpeed: 2.2, // a player moving faster than this is still getting into position: no split step
  splitSkip: 0.12, // chance a set player skips the split step anyway
};

export const AUDIO = {
  volume: 0.6,
  reverb: 0.22, // send into the stadium reverb
  crowd: 1, // crowd bus
  gruntPitch: [112, 128], // each player's voice, Hz
  surfaceBounce: { clay: 1, grass: 0.75, hard: 1.2 }, // bounce loudness by court
  // how often a player grunts, by shot: big efforts more often, touch shots rarely
  gruntChance: { serve: 0.5, smash: 0.75, power: 0.35, hit: 0.1, slice: 0.05, volley: 0.04, lob: 0.03 },
  levels: {
    strike: 1.0, bounce: 0.4, net: 1.2, slide: 0.33,
    chatter: 0.22, hush: 0.05, // stadium bed between points and during play
    applause: 0.82, whistle: 0.2,
    grunt: 0.5, call: 1.6, // line-call volume relative to the master volume
    squeak: 0.32,
  },
};

export const SWING = {
  duration: 0.5,
  ideal: 0.18, // ideal contact time after the press
  windowStart: 0.06,
  windowEnd: 0.34,
  perfect: 0.045,
};

export const SERVE_ANIM = {
  tossDuration: 0.7, // time for the body to reach the trophy pose
  swingDuration: 0.5,
  contact: 0.18,
  landSpeed: 2.4, // the server's forward carry after contact, m/s, easing to a stop
  landTime: 0.3,
};

export const ANIM = {
  strideLength: 2.3, // metres per full run cycle at top speed
  strideBase: 1.0, // stride length per cycle at walking pace; grows with speed
  shuffleMax: 3.2, // below this speed a sideways move is a side shuffle facing the net
  shuffleStride: 1.1,
  footPlant: true, plantRunFrom: 2.2, plantRunTo: 3.6, plantWalkFrom: 0.5, plantWalkTo: 1.0, // planted feet and leg IK: standing, adjusting steps, side shuffles
  capturedStrokes: true, // strokes and serves from motion capture (false: the hand-made clips)
  reachStrength: 0.9, reachFront: 0.3, serveReachY: 2.8, // captured strokes: the racket arm reaches for the ball around contact
  gaitStride: 0.8, // captured gaits: distance per cycle, relative to the actor's (in leg lengths)
  entryBlend: 0.07, // seconds to blend from the current pose into a new stroke or serve
  springFreq: 26, // rad/s, smoothing springs on the body (higher is tighter)
  splitTime: 0.34, // split step duration: starts as the opponent swings, lands about as the ball is struck
  runBlendSpeed: 2.4, // speed at which the run pose is fully blended in
  runBlendRate: 9,
  turnRate: 10,
  backpedalRatio: 0.4, // mostly straight back counts as moving backwards
  backpedalMaxSpeed: 2.8, // faster than this backwards, the player turns and runs
  turnedRunEnd: 1.6, // a turned run lasts until the player slows below this
  idleHz: 1.5,
};

export const BALL = {
  radius: 0.033,
  visualRadius: 0.05, // drawn a little larger than life (1.5x) so it reads from the broadcast camera
  gravity: 9.8,
  // bounce and friction depend on the court: see SURFACES
  drag: 0.0185, // air drag per (m/s): 0.5 rho Cd A / m for a tennis ball
  magnus: 0.0359, // Magnus force per (lift x speed^2): 0.5 rho A / m
  spinKick: 0.6, // topspin: extra bounce height per unit lift
  spinGrip: 0.6, // topspin keeps more pace off the bounce, backspin less
  fixedDt: 1 / 120, // game step
  maxSubstep: 1 / 240, // ball integration step
  restSpeed: 0.6, // below this vertical speed the ball rolls instead of bouncing
  cordBelow: 0.025, // a ball centre up to this far below the tape still clips it (net cord)
};

export const SHOT = {
  driveSpeed: 28, // launch m/s (about 100 km/h); air drag slows it over the court
  perfectSpeed: 32,
  sliceFactor: 0.78,
  lobTime: 2.0, // flight time of a lob, seconds
  netMargin: 0.22, // minimum clearance over the net
  flightStretch: 1.06, // flight time multiplier per retry until the net is cleared
  aimX: 3.1, // lateral target with left or right held
  depthDefault: 8.6, // landing distance from the net
  depthDeep: 10.5,
  depthShort: 5.4,
  lobDepth: 9.8,
  timingShift: 20, // metres of sideways target shift per second of timing error
  shortRate: 2.0, // fraction of depth lost per second of timing error
  maxShort: 0.35,
  minContactHeight: 0.25,
  // Net cords: a mistimed shot can fly low enough to clip the tape.
  netRiskChance: 0.05, // chance at a badly mistimed shot (scaled down for small timing errors)
  netRiskWindow: 1.8, // only shots crossing within this height of the tape are affected (not lobs)
  netRiskLow: -0.035, // crossing height range, ball centre above the tape: below about -0.025 is the net
  netRiskHigh: 0.045,
};

// Where a swing can meet the ball, relative to the player.
export const CONTACT = {
  front: 0.4, // hitting plane, metres in front of the player
  depth: 1.3, // how far past the plane a late ball can still be hit
  reachX: 1.5,
  reachY: 2.7,
};

// Dive: a swing at a ball passing just beyond normal reach becomes a sideways dive.
// It reaches further, but the shot is weak and the player is down for a while.
export const DIVE = {
  from: 1.45, // predicted sideways distance to the ball at contact beyond which a swing dives
  maxStart: 2.35, // and up to which a dive can still get there
  maxHeight: 1.7, // balls higher than this are not dived for
  lead: 0.34, // only for a ball this close (seconds to contact); earlier, there is still time to run
  reachX: 2.0, // sideways reach while diving (from the player's moving position)
  lunge: 4.2, // m/s sideways launch
  flight: 0.36, // seconds in the air before landing
  airDrag: 1.5, // m/s^2 in the air
  slideDecel: { clay: 6, grass: 8, hard: 13 }, // m/s^2 sliding on the ground after landing
  duration: 1.55, // until back on the feet and ready
  speedFactor: 0.6, // of a normal drive's speed
  depth: 0.62, // fraction of the usual depth (a short, defensive ball)
  scatter: 1.2, // metres of extra sideways error
  netRisk: 0.3, // chance it flies low enough to catch the tape
};

// Line calls and challenges. On a ball this close to a line the line judge can get
// it wrong, more often the closer it is; a player can challenge with Hawk-Eye.
export const CALLS = {
  close: 0.08, // metres either side of the line where a call can be wrong
  missRate: 0.4, // chance of a wrong call on a ball right on the line edge, falling to 0 at `close`
  challenges: 3, // unsuccessful challenges allowed per player per match
  window: 1.4, // seconds after the bounce to challenge
  reviewTime: 3.2, // the Hawk-Eye review
  afterReview: 1.3, // pause after the verdict
  // CPU: how often it challenges a wrong call against it, and a correct close one (hopeful)
  cpuWrong: 0.7, cpuHopeful: 0.25,
};

// Stamina, 1 (fresh) to 0 (spent). Running hard, sliding, diving and big shots use it;
// standing, the breaks between points and the change of ends after a game restore it.
// Below `tiredFrom` a player gets gradually slower, weaker and less accurate.
export const STAMINA = {
  run: 0.028, // per second at top speed (scales with the square of speed)
  slide: 0.02, dive: 0.07, hit: 0.004, power: 0.008, serve: 0.008, // per action
  restRally: 0.015, // per second when nearly still in a rally
  restPause: 0.036, // per second between points
  changeover: 0.12, // after each game
  tiredFrom: 0.6,
  // at 0 stamina: top speed, acceleration and shot speed lost; aim error in metres
  speedLoss: 0.12, accelLoss: 0.25, shotLoss: 0.08, scatter: 0.9,
  cpuError: 0.06, // extra CPU miss chance at 0 stamina
};

// Shot power: hold the shot key to charge, release to swing (the swing starts on
// release). A tap plays at `tap` power; a full charge takes `full` seconds. Power speeds
// the ball up and spreads the errors (direction, depth, net); perfect timing tames them.
export const POWER = {
  tap: 0.35, minHold: 0.12, full: 0.8, maxHold: 1.6, // seconds; held past maxHold it swings anyway
  shot: [0.88, 0.3], volley: [0.95, 0.15], serve: [0.86, 0.26], // speed factor = a + b * power
  scatter: 1.3, depthSpread: 1.1, netRisk: 0.12, // at full power, mistimed
  serveScatter: 0.7, serveDepth: 0.5,
  calm: 0.45, // error multiplier with perfect timing
  chargeMove: 0.72, // movement speed while charging
};

// Spin of each shot, as a lift coefficient (see BALL.magnus): positive is topspin.
export const SPIN = {
  drive: 0.17, lob: 0.12, slice: -0.11, volley: -0.04, smash: 0.03,
  serve: 0.04, secondServe: 0.14, serveSlice: 0.06,
};

// Volley: a ball taken out of the air by a player inside the volley zone.
export const VOLLEY = {
  zoneZ: 8.5, // within this distance of the net a ball that has not bounced is volleyed
  speed: 23, // launch m/s
  perfectSpeed: 27,
  aimX: 3.3,
  depthDefault: 8.2,
  depthDeep: 10.2,
  depthShort: 4.6,
  dropSpeed: 15, // slice on a volley is a drop volley: soft and short
  dropDepth: 3.0,
  cpuSpeedFactor: 0.85,
};

// Overhead smash: a drive pressed when the ball will arrive high.
export const SMASH = {
  minHeight: 1.9, // predicted ball height that turns a drive into a smash
  contactMin: 1.5, // below this at contact it is played as a normal drive
  reachY: 3.2,
  speed: 38, // launch m/s
  perfectSpeed: 44,
  netMargin: 0.15,
  aimX: 3.3,
  depthDefault: 7.2,
  depthDeep: 9.8,
  depthShort: 4.6,
  cpuHeight: 2.3, // CPU takes lobs out of the air at this height
  cpuLobApex: 3.2, // only balls that climbed this high count as lobs
  cpuSpeedFactor: 1.45,
  cpuTimeMargin: 0.15, // spare seconds the CPU wants to get under a lob
};

export const AI = {
  defaultLevel: 'normal',
  // Difficulty settings.
  //   speed        top movement speed, m/s
  //   errorSize    spread of the landing point around the target, metres
  //   errorRate    chance of an unforced miss (long or wide) on any shot
  //   reaction     seconds before the CPU starts moving to a new ball
  //   recover      fraction of top speed used when walking back to the centre
  //   reach        how far from its body the CPU can still hit the ball, metres
  //   pressure     extra error spread when stretched (multiplier at full stretch)
  //   pressureMiss extra miss chance at full stretch
  //   awayChance   how often it aims away from the player
  //   shotSpeed    drive speed, m/s; serveSpeed and serveError (timing spread, seconds)
  //   netRush      chance of following a short-ball attack to the net
  // diveChance: how often the CPU dives for a ball just out of reach
  // fitness: how fast it tires (stamina use multiplier; the player is 1)
  levels: {
    easy: { fitness: 1.2, diveChance: 0.12, speed: 5.0, errorSize: 1.2, errorRate: 0.09, reaction: 0.33, recover: 0.5, reach: 1.35, pressure: 1.0, pressureMiss: 0.14, awayChance: 0.55, shotSpeed: 23, serveSpeed: 33, serveError: 0.1, netRush: 0.15 },
    normal: { fitness: 1.0, diveChance: 0.2, speed: 5.6, errorSize: 0.8, errorRate: 0.04, reaction: 0.21, recover: 0.6, reach: 1.4, pressure: 0.8, pressureMiss: 0.07, awayChance: 0.75, shotSpeed: 27, serveSpeed: 39, serveError: 0.075, netRush: 0.25 },
    hard: { fitness: 0.85, diveChance: 0.3, speed: 6.2, errorSize: 0.5, errorRate: 0.022, reaction: 0.11, recover: 0.75, reach: 1.5, pressure: 0.6, pressureMiss: 0.045, awayChance: 0.88, shotSpeed: 31, serveSpeed: 45, serveError: 0.05, netRush: 0.35 },
  },
  stretchRun: 6, // metres of running that count as fully stretched
  stretchPaceMin: 19, // incoming ball speed where pace starts to add pressure, m/s
  stretchPaceMax: 31,
  wideMiss: 0.9, // metres outside the sideline on a forced wide miss
  netRisk: 0.012, // chance a CPU shot flies low enough to clip the tape
  netRiskStretch: 0.03, // extra chance when it is stretched
  hitHeight: 1.05, // preferred contact height after the bounce
  sideOffset: 0.75, // how far beside the ball the CPU sets up
  forehandBias: 0.4, // metres of extra travel the CPU accepts to hit a forehand
  aimX: 2.9,
  approachZ: 8.0, // an incoming ball bouncing this close to the net is short: the CPU may attack it
  deepRushFactor: 0.3, // net-rush chance off a deep ball, as a fraction of netRush
  netZ: 3.6, // where the CPU stands at the net
  volleyMinY: 0.35, // lowest ball the CPU volleys; lower ones it lets bounce
  volleyMaxY: 1.85,
  volleyNetGap: 1.6, // closest to the net the CPU will take a volley, metres
  volleyTimeMargin: 0.12, // spare seconds it wants to be set for a volley
  depthMin: 7.8,
  depthMax: 10.3,
  longMiss: 1.6, // metres past the baseline on a forced long miss
  sliceChance: 0.15,
  lobChance: 0.6, // when the player is at the net
  lobNetZ: 5,
  leaveMargin: 0.12, // CPU leaves balls landing this far outside the lines
  recoverZ: 12.9,
  maxZ: 16.4,
  minZ: 1.2,
  maxX: 8.6,
  arrive: 7, // 1/s, slows the CPU as it nears its spot
  brake: 9, // m/s^2, the braking curve it runs on as it arrives
};

export const SERVE = {
  standX: 1.1, // server distance from the centre mark
  standBehind: 0.45, // behind the baseline
  minX: 0.25, // the human server may shuffle along the baseline between these
  maxX: 3.8,
  receiverX: 2.9,
  receiverBehind: 0.9,
  readyDelay: 0.5, // before the human can toss
  cpuDelay: 1.3, // before the CPU tosses
  handY: 1.13, // ball held in the left hand, out in front of the front hip
  handSide: 0.37, // toward the hitting side (the stance is side-on)
  handFront: 0.48, // toward the net
  tossY0: 1.45, // release height
  tossApex: 3.0, // top of the toss
  tossFront: 0.35, // toss position in front of the server
  tossSide: 0.12, // and toward the hitting side
  retossHeight: 1.15, // an unhit toss falling below this is simply retaken
  perfect: 0.06, // seconds either side of the top of the toss
  speed: 41, // launch m/s (about 148 km/h)
  perfectSpeed: 47,
  secondFactor: 0.85, // second serve speed multiplier
  secondForgive: 0.6, // second serve timing errors count this much
  sliceFactor: 0.85,
  depth: 5.3, // landing distance from the net
  secondDepth: 4.9,
  aimX: 1.35, // left or right held moves the target this far inside the box
  longRate: 7, // metres deeper per second of early error
  shortRate: 1.5, // metres shorter per second of late error
  lateDrop: 6, // m/s of downward launch speed per second of late error
  scatter: 3, // metres of sideways scatter per second of error
  netMargin: 0.12,
  faultDelay: 1.4,
};

export const RALLY = {
  pointDelay: 1.9, // pause after a point
  matchOverDelay: 2.6,
  outX: 12, // ball leaving this box ends the point
  outZ: 20,
};

// Everything here is invented. No real brands, tours, or athletes.
export const NAMES = {
  tour: 'PORTO VELANO OPEN',
  round: 'FINAL',
  gamesToWin: 6,
  // player and CPU names and looks live in profile.js (the CPU's are invented)
  sponsors: [
    { text: 'VOLTIQUE', bg: '#0d3b66', fg: '#ffffff' },
    { text: 'NORDHAVEN AIR', bg: '#f4f1ea', fg: '#12355b' },
    { text: 'AQUOLA', bg: '#0a6c74', fg: '#eafcff' },
    { text: 'ORBEXA BANK', bg: '#1b1f27', fg: '#f2c14e' },
    { text: 'LUMARO', bg: '#7a1f2b', fg: '#ffffff' },
    { text: 'TANDRIX', bg: '#f2c14e', fg: '#1b1f27' },
    { text: 'HALVORNE', bg: '#24303f', fg: '#dfe7f1' },
    { text: 'ZEPHRON MOTORS', bg: '#ffffff', fg: '#b3261e' },
    { text: 'PIXAVO', bg: '#2d1e4f', fg: '#e9ddff' },
  ],
};
