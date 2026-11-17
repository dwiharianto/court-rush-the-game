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
  accel: 14, // how quickly velocity approaches the input, 1/s
  swingMoveFactor: 0.35, // movement speed multiplier while swinging
  startZ: 12.5,
  minZ: 1.2,
  maxZ: 16.5,
  maxX: 8.6,
};

export const AUDIO = {
  volume: 0.5,
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
};

export const ANIM = {
  strideLength: 2.3, // metres per full run cycle
  runBlendSpeed: 2.4, // speed at which the run pose is fully blended in
  runBlendRate: 9,
  turnRate: 10,
  maxTurn: 1.75,
  backpedalRatio: 0.4,
  idleHz: 1.5,
};

export const BALL = {
  radius: 0.033,
  visualRadius: 0.085, // drawn larger than life so it reads from the broadcast camera
  gravity: 9.8,
  bounce: 0.74, // vertical speed kept on a bounce
  sliceBounce: 0.6,
  friction: 0.8, // horizontal speed kept on a bounce
  fixedDt: 1 / 120, // game step
  maxSubstep: 1 / 240, // ball integration step
  restSpeed: 0.6, // below this vertical speed the ball rolls instead of bouncing
};

export const SHOT = {
  driveSpeed: 20, // horizontal m/s
  perfectSpeed: 24,
  sliceFactor: 0.72,
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
};

// Where a swing can meet the ball, relative to the player.
export const CONTACT = {
  front: 0.4, // hitting plane, metres in front of the player
  depth: 1.3, // how far past the plane a late ball can still be hit
  reachX: 1.5,
  reachY: 2.7,
};

// Overhead smash: a drive pressed when the ball will arrive high.
export const SMASH = {
  minHeight: 1.9, // predicted ball height that turns a drive into a smash
  contactMin: 1.5, // below this at contact it is played as a normal drive
  reachY: 3.2,
  speed: 30, // horizontal m/s
  perfectSpeed: 35,
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
  levels: {
    easy: { speed: 5.0, errorSize: 1.2, errorRate: 0.09, reaction: 0.4, recover: 0.5, reach: 1.35, pressure: 1.0, pressureMiss: 0.14, awayChance: 0.55, shotSpeed: 17, serveSpeed: 23, serveError: 0.1 },
    normal: { speed: 5.4, errorSize: 0.8, errorRate: 0.05, reaction: 0.28, recover: 0.6, reach: 1.4, pressure: 0.8, pressureMiss: 0.09, awayChance: 0.75, shotSpeed: 20, serveSpeed: 27, serveError: 0.075 },
    hard: { speed: 6.2, errorSize: 0.5, errorRate: 0.03, reaction: 0.2, recover: 0.75, reach: 1.5, pressure: 0.6, pressureMiss: 0.06, awayChance: 0.88, shotSpeed: 23, serveSpeed: 31, serveError: 0.05 },
  },
  stretchRun: 6, // metres of running that count as fully stretched
  stretchPaceMin: 19, // incoming ball speed where pace starts to add pressure, m/s
  stretchPaceMax: 31,
  wideMiss: 0.9, // metres outside the sideline on a forced wide miss
  fatigueStart: 12, // rally length (total hits) after which the CPU starts to tire
  fatigueRate: 0.004, // extra miss chance per hit beyond that
  hitHeight: 1.05, // preferred contact height after the bounce
  sideOffset: 0.75, // how far beside the ball the CPU sets up
  forehandBias: 0.4, // metres of extra travel the CPU accepts to hit a forehand
  aimX: 2.9,
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
  handY: 1.15, // ball held in the left hand
  tossY0: 1.45, // release height
  tossApex: 3.0, // top of the toss
  tossFront: 0.35, // toss position in front of the server
  tossSide: 0.12, // and toward the hitting side
  retossHeight: 1.15, // an unhit toss falling below this is simply retaken
  perfect: 0.06, // seconds either side of the top of the toss
  speed: 30,
  perfectSpeed: 37,
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
  player: 'L. MARLOW',
  playerKit: { shirt: 0x2f9e58, shorts: 0x2452a6, skin: 0xd9a37c, hair: 0x2a1d14, shoes: 0xf4f4f4, racketColor: 0x16181c },
  cpuKit: { shirt: 0xf6f6f2, shorts: 0xf0f0ec, skin: 0xc98f68, hair: 0x1a1512, shoes: 0xffffff, racketColor: 0xb3261e },
  cpu: 'D. VESPER',
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
