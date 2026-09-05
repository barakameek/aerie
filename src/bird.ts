import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
} from 'three'
import type { FlightInput } from './input.ts'
import { clamp, damp, lerp, smoothstep, wrapAngle } from './math.ts'
import { treeHitRadius, treeHitTop, type Forest, type TreeCollider } from './forest.ts'
import { SEA_LEVEL, type Planet } from './planet.ts'

const Z_AXIS = new Vector3(0, 0, 1)

const MIN_SPEED = 6
const CRUISE_MAX = 45
export const SPRINT_CAP_MIN = 45
export const SPRINT_CAP_MAX = 100
export const SPRINT_CAP_DEFAULT = 60
const THROTTLE_ACCEL = 16
const FLAP_LIFT = 2.6
const HOLD_CLIMB = 14
const BRAKE_SINK = 16
const AUTO_LIFT = 7.5
const TAKEOFF_LIFT = 5.5
const SLOW_PERIOD = 0.92
const FAST_PERIOD = 0.3
const LATE_START = 0.52
const GLIDE_LIFT = 0.05
const TUCK_LIFT = 0.72
type WingPose = { lift: number; sweep: number; fold: number }
const GLIDE: WingPose = { lift: GLIDE_LIFT, sweep: 0.08, fold: 0.12 }
const SPRINT: WingPose = { lift: 0.22, sweep: -0.18, fold: 1.18 }
const BANK: WingPose = { lift: 0.14, sweep: -0.14, fold: 0.78 }
const UP: WingPose = { lift: 1.52, sweep: -0.22, fold: 0.48 }
const EARLY: WingPose = { lift: 0.52, sweep: 0.42, fold: 0.36 }
const POWER: WingPose = { lift: -0.38, sweep: 0.82, fold: 0.46 }
const LATE: WingPose = { lift: -1.08, sweep: 0.1, fold: 0.88 }
const YAW_RATE_SLOW = 1.82
const YAW_RATE_FAST = 0.34
const COORD_RATE = 1.48
const PITCH_RATE = 1.22
const DIVE_PITCH_RATE = 1.55
const MAX_CLIMB_PITCH = 0.82
const MAX_DIVE_PITCH = 1.52
const MAX_BANK_SLOW = 0.2
const MAX_BANK_FAST = 1.22
const TURN_SLOW = 14
const TURN_FAST = 38
const WING_BANK = 0.55
const BANK_FOLLOW_SLOW = 8.5
const BANK_FOLLOW_FAST = 11
const VISUAL_BANK_SLOW = 0.82
const VISUAL_BANK_FAST = 1.52
const VISUAL_BANK_MAX = 1.52
const BODY_RADIUS = 0.34
const BODY_NOSE = 0.66
const BODY_TAIL = 0.5
const TREE_QUERY = 40
const BODY_SAMPLES = 5
const WALK_HEIGHT = 0.78
const LAND_SPEED = 10
const LAND_ALT = 1.85
const LAND_SINK = 5.5
const TOUCH_SKIN = 0.42
const FEET_NEAR = 2.1
const WALK_SPEED = 3.4
const DIVE_ENERGY = 0.55
const CLIMB_ENERGY_SLOW = 0.62
const CLIMB_ENERGY_FAST = 0.16
const CLIMB_BLEED_CAP_SLOW = 18
const CLIMB_BLEED_CAP_FAST = 8
const CLIMB_NOSE = 0.08
const DIVE_NOSE = -0.06
const SPRINT_BLEED = 2.15
const STALL_SPEED = 10
const STALL_CLEAR = 11.3
const SOAR_DRAG = 0.26
const SOAR_DRAG_GAIN = 0.0065
const SINK_FAST = 0.8
const SINK_SLOW = 3.6
const SINK_ENERGY = 0.13
const CEILING_START = 150
const CEILING_STOP = 260
const THIN_AIR_SINK = 5.5
const IMPACT_FREE = 14
const IMPACT_FULL = 62
const IMPACT_LOSS = 0.72
const TREE_STRIKE_LOSS = 0.55
const TREE_ESCAPE = 19
const WATER_SKIN = 0.7
const SPLASH_FREE = 6
const SPLASH_FULL = 34
const SPLASH_LOSS = 0.6

export class Bird {
  readonly group = new Group()
  readonly position = new Vector3()
  readonly forward = new Vector3(0, 0, 1)
  readonly up = new Vector3(0, 1, 0)
  readonly right = new Vector3(1, 0, 0)
  readonly velocity = new Vector3()

  yaw = 0.35
  pitch = 0.08
  roll = 0
  speed = 18
  airSpeed = 18
  altitude = 0
  combo = 0
  beatCue = 0
  beatApproach = 0
  inWindow = false
  meterActive = false
  walking = false
  tuck = false
  autoFlap = false
  turnStyle = 0
  steer = 0
  sprintCap = SPRINT_CAP_DEFAULT
  call = 'Hold Space to climb'
  hitDepth = 0

  readonly shadow: Mesh
  /** Anchor at the beak for whatever the bird is carrying. */
  readonly carryRig = new Group()
  private readonly headRig = new Group()
  private readonly leftWing: Group
  private readonly rightWing: Group
  private readonly leftElbow: Group
  private readonly rightElbow: Group
  private readonly leftTip: Mesh
  private readonly rightTip: Mesh
  private readonly leftLeg: Group
  private readonly rightLeg: Group
  private readonly tail: Mesh
  private feet = 0
  private walkPhase = 0
  private stroke = 1
  private flapStage: 'idle' | 'beat' = 'idle'
  private flapBlend = 1
  private seenApex = false
  private lift = GLIDE_LIFT
  private sweep = 0.08
  private elbowFold = 0.12
  private fromLift = GLIDE_LIFT
  private fromSweep = 0.08
  private fromFold = 0.12
  private holdFlap = false
  private pendingLift = 0
  private callTimer = 0
  private stuck = 0
  private descentAssist = 0
  private treeContact = false
  private visualPitch = 0.06
  visualRoll = 0
  private readonly lastPos = new Vector3()
  private readonly groundNormal = new Vector3()
  readonly heading = new Vector3(0, 0, 1)
  readonly localUp = new Vector3(0, 1, 0)
  private lastAlt = 0
  private lastRadial = 0
  private readonly basis = new Matrix4()
  private readonly _east = new Vector3()
  private readonly _north = new Vector3()
  private readonly _rel = new Vector3()
  private readonly _radial = new Vector3()
  private readonly _push = new Vector3()
  private readonly _bodyA = new Vector3()
  private readonly _bodyB = new Vector3()
  private readonly _axisA = new Vector3()
  private readonly _hitA = new Vector3()
  private readonly _escape = new Vector3()
  private readonly _segA = new Vector3()
  private readonly _visFwd = new Vector3()
  private readonly _visUp = new Vector3()
  private readonly _visRight = new Vector3()
  private readonly _shadowN = new Vector3()

  constructor() {
    const amber = new MeshLambertMaterial({ color: '#e56a1a', flatShading: true })
    const cream = new MeshLambertMaterial({ color: '#f3d7a4', flatShading: true })
    const dusk = new MeshLambertMaterial({ color: '#c44b12', flatShading: true })
    const beakMat = new MeshLambertMaterial({ color: '#f0a35a', flatShading: true })
    const eyeMat = new MeshLambertMaterial({ color: '#1b1410', flatShading: true })

    const body = new Mesh(new IcosahedronGeometry(0.55, 0), amber)
    body.scale.set(0.62, 0.5, 1.28)
    this.group.add(body)

    const belly = new Mesh(new IcosahedronGeometry(0.42, 0), cream)
    belly.scale.set(0.55, 0.38, 1.05)
    belly.position.set(0, -0.12, 0.05)
    this.group.add(belly)

    const head = new Mesh(new IcosahedronGeometry(0.26, 0), amber)
    const beak = new Mesh(new ConeGeometry(0.07, 0.28, 4), beakMat)
    beak.rotation.x = Math.PI / 2
    beak.position.set(0, -0.04, 0.26)
    const eyeL = new Mesh(new IcosahedronGeometry(0.045, 0), eyeMat)
    eyeL.position.set(0.14, 0.06, 0.12)
    const eyeR = eyeL.clone()
    eyeR.position.x = -0.14
    this.headRig.position.set(0, 0.16, 0.62)
    this.headRig.add(head, beak, eyeL, eyeR)
    this.carryRig.position.set(0, -0.12, 0.34)
    this.headRig.add(this.carryRig)
    this.group.add(this.headRig)

    this.tail = new Mesh(new ConeGeometry(0.22, 0.7, 4), dusk)
    this.tail.rotation.x = -Math.PI / 2.4
    this.tail.position.set(0, 0.02, -0.78)
    this.tail.scale.set(1.15, 0.45, 1)
    this.group.add(this.tail)

    const left = makeWing(1, amber, dusk)
    const right = makeWing(-1, amber, dusk)
    this.leftWing = left.root
    this.leftElbow = left.elbow
    this.leftTip = left.tip
    this.rightWing = right.root
    this.rightElbow = right.elbow
    this.rightTip = right.tip
    this.leftLeg = makeLeg(1, dusk, cream)
    this.rightLeg = makeLeg(-1, dusk, cream)
    this.group.add(this.leftWing, this.rightWing, this.leftLeg, this.rightLeg)
    this.shadow = new Mesh(
      new CircleGeometry(1.15, 10),
      new MeshBasicMaterial({ color: '#1a1812', transparent: true, opacity: 0.22, depthWrite: false }),
    )
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.position.set(x, y, z)
    this.yaw = yaw
    this.pitch = 0
    this.roll = 0
    this.speed = 18
    this.airSpeed = 18
    this.combo = 0
    this.stroke = 1
    this.flapStage = 'idle'
    this.flapBlend = 1
    this.seenApex = false
    this.autoFlap = false
    this.meterActive = false
    this.inWindow = false
    this.lift = GLIDE_LIFT
    this.sweep = 0.08
    this.elbowFold = 0.12
    this.holdFlap = false
    this.pendingLift = 0
    this.walking = false
    this.tuck = false
    this.stuck = 0
    this.treeContact = false
    this.descentAssist = 0
    this.turnStyle = 0
    this.steer = 0
    this.feet = 0
    this.walkPhase = 0
    this.call = 'Hold Space to climb'
    this.visualPitch = 0
    this.visualRoll = 0
    this.lastAlt = 0
    this.lastRadial = this.position.length()
    this.lastPos.copy(this.position)
    this.syncGroup(0)
  }

  markRest(): void {
    this.lastPos.copy(this.position)
    this.lastAlt = this.altitude
    this.lastRadial = this.position.length()
  }

  alignToPlanet(planet: Planet): void {
    planet.radialUp(this.position, this.localUp)
    planet.tangentBasis(this.localUp, this._east, this._north)
    this.heading
      .copy(this._east)
      .multiplyScalar(Math.sin(this.yaw))
      .addScaledVector(this._north, Math.cos(this.yaw))
      .normalize()
    this.refreshFrame(planet)
    this.altitude = planet.altitude(this.position)
    this.lastAlt = this.altitude
    this.lastRadial = this.position.length()
    this.lastPos.copy(this.position)
    this.placeShadow(planet)
    this.syncGroup(0)
  }

  update(dt: number, input: FlightInput, planet: Planet, forest: Forest): void {
    const mouseTurn = input.freeLook ? 0 : -input.mouseYaw * 0.0024
    const mousePitch = input.freeLook ? 0 : input.mousePitch * 0.0021

    this.hitDepth = 0
    if (this.walking) {
      this.tuck = false
      this.autoFlap = false
      this.turnStyle = 0
      this.steer = 0
      this.updateWalk(dt, input, planet, forest)
      return
    }

    this.turnStyle = smoothstep(TURN_SLOW, TURN_FAST, this.airSpeed)
    this.steer = input.yaw
    const yawRate = lerp(YAW_RATE_SLOW, YAW_RATE_FAST, this.turnStyle)
    const maxBank = lerp(MAX_BANK_SLOW, MAX_BANK_FAST, this.turnStyle)
    const mouseBank = clamp(mouseTurn * lerp(10, 22, this.turnStyle), -maxBank * 0.75, maxBank * 0.75)
    const targetRoll = clamp(-input.yaw * maxBank - mouseBank, -maxBank, maxBank)
    this.roll = damp(this.roll, targetRoll, lerp(BANK_FOLLOW_SLOW, BANK_FOLLOW_FAST, this.turnStyle), dt)

    const yawDelta =
      input.yaw * yawRate * dt +
      -this.roll * COORD_RATE * this.turnStyle * dt +
      mouseTurn * lerp(1, 0.36, this.turnStyle)
    this.yaw = wrapAngle(this.yaw + yawDelta)
    const noseDown = input.pitch < 0 || mousePitch > 0
    const pitchRateIn = noseDown ? DIVE_PITCH_RATE : PITCH_RATE
    this.pitch = clamp(
      this.pitch + input.pitch * pitchRateIn * dt - mousePitch,
      -MAX_DIVE_PITCH,
      MAX_CLIMB_PITCH,
    )

    this.tuck = input.tuck
    this.refreshAutoFlap(input.brake)
    this.holdFlap = input.glide || this.autoFlap
    this.advanceFlap(dt)
    if (input.flap) this.flapOnce()
    if (input.brake) this.speed = damp(this.speed, 1.1, 3.4, dt)
    else this.applyThrottle(dt, input)

    this.refreshFrame(planet)
    this.heading.applyAxisAngle(this.localUp, yawDelta)
    this.refreshFrame(planet)

    const diveAmt = clamp(-this.pitch / 0.34, 0, 1)
    const travel = this.speed * (1 + 0.5 * diveAmt)
    const ceiling = this.tuck ? this.sprintCap : Math.max(CRUISE_MAX, this.speed)
    this.airSpeed = Math.min(ceiling, travel)
    this.velocity.copy(this.forward).multiplyScalar(this.airSpeed)
    this.position.addScaledVector(this.velocity, dt)
    this.descentAssist = this.applyGlideSink(dt, input)
    if (input.brake) {
      this.position.addScaledVector(this.localUp, -BRAKE_SINK * dt)
      this.descentAssist += BRAKE_SINK * dt
    }

    this.resolveWater(dt, input.brake, planet)
    this.resolveGround(dt, planet, input.brake)
    this.resolveTrees(dt, forest)
    this.refreshFrame(planet)
    this.applyEnergy(dt, input.brake)
    this.applySoarDrag(dt, input)
    this.applySpeedCap(dt, input.brake)
    this.applyClimbLift(dt, input)
    this.updateBeatCue(dt)
    this.animate(dt, input)

    this.altitude = planet.altitude(this.position)
    this.placeShadow(planet)
    this.syncGroup(dt)
    this.lastPos.copy(this.position)
    this.lastAlt = this.altitude
    t