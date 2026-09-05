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
    this.lastRadial = this.position.length()
  }

  private updateWalk(dt: number, input: FlightInput, planet: Planet, forest: Forest): void {
    // Holding Space has to work too: after a landing the one-shot flap is already spent.
    if (input.flap || input.glide) {
      this.walking = false
      this.pitch = 0.12
      this.speed = Math.max(this.speed, MIN_SPEED * 2)
      this.position.addScaledVector(this.localUp, TAKEOFF_LIFT)
      this.flapOnce()
      this.flushClimbLift()
      this.lastPos.copy(this.position)
      this.lastAlt = planet.altitude(this.position)
      this.lastRadial = this.position.length()
      return
    }

    const mouseTurn = input.freeLook ? 0 : -input.mouseYaw * 0.0032
    const yawDelta = input.yaw * 2.1 * dt + mouseTurn
    this.yaw = wrapAngle(this.yaw + yawDelta)
    this.pitch = damp(this.pitch, 0.02, 8, dt)
    this.roll = damp(this.roll, 0, 8, dt)

    const want = input.throttle > 0 ? WALK_SPEED : input.pitch > 0 ? -1.4 : 0
    const halt = input.brake ? 6 : 5
    this.speed = damp(this.speed, want, halt, dt)

    this.refreshFrame(planet)
    this.heading.applyAxisAngle(this.localUp, yawDelta)
    this.position.addScaledVector(this.heading, this.speed * dt)
    planet.placeAbove(this.position, WALK_HEIGHT)
    this.refreshFrame(planet)
    this.resolveTrees(dt, forest)
    this.hitDepth = this._push.length()
    planet.placeAbove(this.position, WALK_HEIGHT)
    this.refreshFrame(planet)

    this.altitude = WALK_HEIGHT
    this.walkPhase += Math.abs(this.speed) * 4.8 * dt
    this.airSpeed = this.speed
    this.flapStage = 'idle'
    this.meterActive = false
    this.call = 'Walking · Space to climb aloft'

    this.animate(dt, input)
    this.placeShadow(planet)
    const blob = this.shadow.material as MeshBasicMaterial
    blob.opacity = 0.28
    this.shadow.scale.setScalar(1.2)
    this.syncGroup(dt)
    this.lastPos.copy(this.position)
    this.lastAlt = this.altitude
    this.lastRadial = this.position.length()
  }

  private resolveGround(dt: number, planet: Planet, braking: boolean): void {
    const agl = planet.altitude(this.position)
    const altitude = agl + GROUND_SLACK
    const step = Math.max(dt, 1 / 120)
    const vy = (agl - this.lastAlt) / step
    // Sink and braking are descents the player asked for, so they must not read as a fall.
    const fall = (agl - this.lastAlt + this.descentAssist) / step

    const settling =
      this.speed < LAND_SPEED &&
      fall > -LAND_SINK &&
      this.pitch > -0.2 &&
      agl <= LAND_ALT &&
      // Walking the seabed is not landing; over water you rest on the surface instead.
      planet.radiusAt(this.position) >= SEA_LEVEL

    if (settling) {
      planet.placeAbove(this.position, WALK_HEIGHT)
      this.startWalk()
      return
    }

    if (altitude > TOUCH_SKIN) {
      this.stuck = Math.max(0, this.stuck - dt)
      return
    }

    planet.normalAt(this.position, this.groundNormal)
    this.position.addScaledVector(this.groundNormal, TOUCH_SKIN - altitude)
    const lifted = planet.altitude(this.position)
    if (lifted < TOUCH_SKIN) this.position.addScaledVector(this.groundNormal, TOUCH_SKIN - lifted)
    if (!braking) this.takeImpact(-fall, IMPACT_FREE, IMPACT_FULL, IMPACT_LOSS, 'Clipped the ground')
    if (vy < -2 || this.pitch < 0) {
      const stoop = clamp(-this.pitch / MAX_DIVE_PITCH, 0, 1)
      this.pitch = damp(this.pitch, 0.14, 8 + stoop * 4, dt)
    }
    this.stuck = Math.max(0, this.stuck - dt)
  }

  /** Hitting something costs the speed you carried into it, scaled by how hard you arrived. */
  private takeImpact(closing: number, free: number, full: number, loss: number, call: string): void {
    const force = clamp((closing - free) / (full - free), 0, 1)
    if (force <= 0) return
    this.speed = Math.max(MIN_SPEED, this.speed * (1 - loss * force))
    if (force > 0.25) {
      this.call = call
      this.callTimer = 0.6
    }
  }

  /** The sea is a floor, not scenery — you skim it or you lose your speed to it. */
  private resolveWater(dt: number, braking: boolean, planet: Planet): void {
    const surface = SEA_LEVEL + WATER_SKIN
    const radial = this.position.length()
    if (radial >= surface || radial < 1e-6) return
    // Only where the sea actually covers the ground; low-lying land is still land.
    if (planet.radiusAt(this.position) >= SEA_LEVEL) return

    const closing = (this.lastRadial - radial) / Math.max(dt, 1 / 120)
    this.position.multiplyScalar(surface / radial)
    if (!braking) this.takeImpact(closing, SPLASH_FREE, SPLASH_FULL, SPLASH_LOSS, 'Splashdown')
    if (this.pitch < 0) this.pitch = damp(this.pitch, 0.1, 9, dt)
  }

  private startWalk(): void {
    this.walking = true
    this.flapStage = 'idle'
    this.speed = clamp(this.speed, 0, WALK_SPEED)
    this.pitch = 0.02
    this.roll = 0
  }

  private resolveTrees(dt: number, forest: Forest): void {
    this._bodyA.copy(this.position).addScaledVector(this.forward, BODY_NOSE)
    this._bodyB.copy(this.position).addScaledVector(this.forward, -BODY_TAIL)
    const nearby = forest.query(this.position, TREE_QUERY)
    let deepest = 0
    this._push.set(0, 0, 0)

    for (const tree of nearby) {
      const hit = this.collideTree(tree)
      if (hit > 0) deepest = Math.max(deepest, hit)
    }

    this.hitDepth = Math.max(this.hitDepth, deepest)

    if (this._push.lengthSq() === 0) {
      this.treeContact = false
      this.stuck = Math.max(0, this.stuck - dt * 2)
      return
    }

    this.position.add(this._push)
    this._bodyA.copy(this.position).addScaledVector(this.forward, BODY_NOSE)
    this._bodyB.copy(this.position).addScaledVector(this.forward, -BODY_TAIL)
    // Only the strike costs speed; resting against bark should not bill you every frame.
    if (!this.treeContact) {
      this.takeImpact(deepest / Math.max(dt, 1 / 120), 10, 40, TREE_STRIKE_LOSS, 'Clipped a tree')
    }
    this.treeContact = true

    // A push that exactly cancels your motion would pin you inside the crown forever.
    const progress = this.position.distanceTo(this.lastPos)
    if (progress < this.airSpeed * dt * 0.4) this.stuck += dt
    else this.stuck = Math.max(0, this.stuck - dt * 2)

    if (this.stuck > 0.4) {
      this._escape.copy(this._push).normalize()
      this.position.addScaledVector(this._escape, TREE_ESCAPE * dt)
      this.call = 'Shaking free of the branches'
      this.callTimer = 0.4
    }
  }

  private collideTree(tree: TreeCollider): number {
    this._rel.copy(this.position).sub(tree.pos)
    const along = this._rel.dot(tree.up)
    const top = treeHitTop(tree)
    if (along > top + BODY_RADIUS + 0.8 || along < -BODY_RADIUS - 0.5) return 0

    this._radial.copy(this._rel).addScaledVector(tree.up, -along)
    const radial = this._radial.length()
    const skirt = treeHitRadius(tree)
    if (radial > skirt + BODY_RADIUS + 0.35) {
      return this.hitShell(tree, 0, tree.foliageBase, tree.trunkHit, tree.trunkHit)
    }

    let deepest = this.hitShell(tree, 0, tree.foliageBase, tree.trunkHit, tree.trunkHit)
    for (const shell of tree.shells) {
      deepest = Math.max(deepest, this.hitShell(tree, shell.y0, shell.y1, shell.r0, shell.r1))
    }
    for (const blob of tree.blobs) {
      this._axisA.copy(tree.pos).addScaledVector(tree.up, blob.along)
      deepest = Math.max(deepest, this.hitSphere(this._axisA, blob.radius))
    }
    return deepest
  }

  /** Finite cone / cylinder with no spherical end-caps — empty air beside a taper stays free. */
  private hitShell(tree: TreeCollider, y0: number, y1: number, r0: number, r1: number): number {
    if (y1 <= y0) return 0
    let deepest = 0
    for (let i = 0; i <= BODY_SAMPLES; i++) {
      const t = i / BODY_SAMPLES
      this._hitA.lerpVectors(this._bodyA, this._bodyB, t)
      deepest = Math.max(deepest, this.pointVsShell(tree, this._hitA, y0, y1, r0, r1))
    }
    return deepest
  }

  private pointVsShell(
    tree: TreeCollider,
    point: Vector3,
    y0: number,
    y1: number,
    r0: number,
    r1: number,
  ): number {
    this._rel.copy(point).sub(tree.pos)
    const along = this._rel.dot(tree.up)
    if (along < y0 || along > y1) return 0
    const u = (along - y0) / (y1 - y0)
    const radius = lerp(r0, r1, u)
    this._radial.copy(this._rel).addScaledVector(tree.up, -along)
    const gap = this._radial.length()
    const pen = radius + BODY_RADIUS - gap
    if (pen <= 0) return 0
    if (gap > 1e-6) this._push.addScaledVector(this._radial.multiplyScalar(1 / gap), pen)
    else this._push.addScaledVector(this.right, pen)
    return pen
  }

  private hitSphere(center: Vector3, radius: number): number {
    this._segA.subVectors(this._bodyB, this._bodyA)
    const len2 = this._segA.lengthSq()
    let t = 0
    if (len2 > 1e-10) {
      t = clamp(this._rel.copy(center).sub(this._bodyA).dot(this._segA) / len2, 0, 1)
    }
    this._hitA.copy(this._bodyA).addScaledVector(this._segA, t)
    const gap = this._hitA.distanceTo(center)
    const pen = radius + BODY_RADIUS - gap
    if (pen <= 0) return 0
    if (gap > 1e-6) this._push.addScaledVector(this._rel.copy(this._hitA).sub(center).normalize(), pen)
    else this._push.addScaledVector(this.right, pen)
    return pen
  }

  /** Knocked off balance by something that hit you rather than something you hit. */
  stagger(fraction: number, call: string): void {
    this.speed = Math.max(MIN_SPEED, this.speed * (1 - clamp(fraction, 0, 1)))
    this.call = call
    this.callTimer = 1.3
  }

  setSprintCap(value: number): void {
    this.sprintCap = clamp(Math.round(value), SPRINT_CAP_MIN, SPRINT_CAP_MAX)
  }

  private refreshAutoFlap(braking: boolean): void {
    const band = this.autoFlap ? STALL_CLEAR : STALL_SPEED
    const want = !this.walking && !this.tuck && !braking && this.speed <= band
    if (want && !this.autoFlap && this.flapStage === 'idle') {
      this.call = 'Slow air — climbing to stay aloft'
      this.callTimer = 0.45
      this.beginBeat()
    }
    this.autoFlap = want
  }

  private flushClimbLift(): void {
    if (this.pendingLift <= 0) return
    this.position.addScaledVector(this.localUp, this.pendingLift * this.ceilingFade())
    this.pendingLift = 0
  }

  private applyClimbLift(dt: number, input: FlightInput): void {
    if (this.tuck || input.brake) return
    this.flushClimbLift()
    const fade = this.ceilingFade()
    if (input.glide) {
      this.position.addScaledVector(this.localUp, HOLD_CLIMB * fade * dt)
    } else if (this.autoFlap) {
      // Beating at stall holds you up rather than lifting you, so idling drifts down to land.
      this.position.addScaledVector(this.localUp, Math.min(AUTO_LIFT * fade, this.sinkRate() * 0.92) * dt)
    }
  }

  private applyEnergy(dt: number, braking: boolean): void {
    if (braking) return
    const radial = this.position.length()
    const dRadial = radial - this.lastRadial
    const expected = Math.sin(this.pitch) * this.speed * dt

    if (this.pitch > CLIMB_NOSE) {
      this.applyClimbBleed(Math.max(0, dRadial, expected), dt)
      return
    }

    if (this.pitch < DIVE_NOSE && dRadial < 0) {
      const gain = -dRadial * DIVE_ENERGY
      if (this.tuck || this.speed < CRUISE_MAX) {
        this.speed += gain
        if (!this.tuck) this.speed = Math.min(this.speed, CRUISE_MAX)
      }
    }
  }

  private applySoarDrag(dt: number, input: FlightInput): void {
    if (input.brake || input.throttle > 0 || this.tuck) return
    if (this.pitch > CLIMB_NOSE || this.pitch < DIVE_NOSE) return
    if (this.speed <= STALL_SPEED) return
    const drag = SOAR_DRAG + this.speed * SOAR_DRAG_GAIN
    this.speed = Math.max(STALL_SPEED, this.speed - drag * dt)
  }

  /** Wings only hold you up while you have air over them: fast is nearly flat, slow falls away. */
  private sinkRate(): number {
    const lift = smoothstep(STALL_SPEED, CRUISE_MAX, this.airSpeed)
    const thin = smoothstep(CEILING_START, CEILING_STOP, this.altitude)
    return lerp(SINK_SLOW, SINK_FAST, lift) + thin * THIN_AIR_SINK
  }

  /** Climb sources fade out as the air thins so you cannot simply leave the planet. */
  private ceilingFade(): number {
    return 1 - smoothstep(CEILING_START, CEILING_STOP, this.altitude)
  }

  private applyGlideSink(dt: number, input: FlightInput): number {
    if (input.brake) return 0
    const drop = this.sinkRate() * dt
    this.position.addScaledVector(this.localUp, -drop)
    // Height falling away buys a little speed back, so a long glide trims out instead of stalling.
    const cap = this.tuck ? this.sprintCap : CRUISE_MAX
    if (this.speed < cap) this.speed = Math.min(cap, this.speed + drop * SINK_ENERGY)
    return drop
  }

  private applyClimbBleed(dy: number, dt: number): void {
    const steep = clamp((this.pitch - CLIMB_NOSE) / (MAX_CLIMB_PITCH - CLIMB_NOSE), 0, 1)
    const climbRate = clamp(dy / Math.max(dt, 1 / 120) / 22, 0, 1)
    const intensity = clamp(steep * 0.55 + climbRate * 0.45, 0, 1)
    const momentum = clamp((this.speed - MIN_SPEED) / (CRUISE_MAX - MIN_SPEED), 0, 1)
    const limp = (1 - momentum) * (1 - momentum)
    const energy = lerp(CLIMB_ENERGY_FAST, CLIMB_ENERGY_SLOW, limp)
    const cap = lerp(CLIMB_BLEED_CAP_FAST, CLIMB_BLEED_CAP_SLOW, limp) * dt
    this.speed -= Math.min(cap, dy * energy * (0.65 + intensity * 0.55))
  }

  private applySpeedCap(dt: number, braking: boolean): void {
    const floor = braking ? 1 : MIN_SPEED
    if (this.tuck) {
      this.speed = clamp(this.speed, floor, this.sprintCap)
      return
    }
    if (this.speed > CRUISE_MAX) {
      this.speed = damp(this.speed, CRUISE_MAX, SPRINT_BLEED, dt)
      if (this.speed < CRUISE_MAX + 0.85) this.speed = CRUISE_MAX
      this.speed = Math.max(this.speed, floor)
      return
    }
    this.speed = clamp(this.speed, floor, CRUISE_MAX)
  }

  private applyThrottle(dt: number, input: FlightInput): void {
    if (input.brake || input.throttle <= 0) return
    const cap = this.tuck ? this.sprintCap : CRUISE_MAX
    if (this.speed >= cap) {
      this.speed = cap
      return
    }
    this.speed = Math.min(cap, this.speed + THROTTLE_ACCEL * input.throttle * dt)
  }

  private beatPeriod(): number {
    const t = clamp((this.speed - MIN_SPEED) / (this.sprintCap - MIN_SPEED), 0, 1)
    return SLOW_PERIOD + (FAST_PERIOD - SLOW_PERIOD) * (t * 0.7 + t * t * 0.3)
  }

  private beginBeat(): void {
    this.fromLift = this.lift
    this.fromSweep = this.sweep
    this.fromFold = this.elbowFold
    this.stroke = 0.75
    this.flapBlend = 0
    this.seenApex = false
    this.flapStage = 'beat'
  }

  private advanceFlap(dt: number): void {
    if (this.flapStage !== 'beat') return
    this.stroke += dt / this.beatPeriod()
    this.flapBlend = Math.min(1, this.flapBlend + dt * 8)
    if (this.stroke < 1) return
    this.stroke -= 1
    this.flapBlend = 1
    if (this.autoFlap) {
      this.call = 'Slow air — climbing to stay aloft'
      this.callTimer = 0.35
    }
    if (this.seenApex && !this.holdFlap) {
      this.flapStage = 'idle'
      return
    }
    this.seenApex = true
  }

  private flapOnce(): void {
    if (this.tuck) {
      this.call = 'Wings tucked — climb after you open'
      this.callTimer = 0.55
      return
    }

    let lift = FLAP_LIFT
    if (this.flapStage === 'idle') {
      this.combo = Math.max(1, this.combo)
      this.call = 'Climb'
      this.pendingLift += lift
      this.callTimer = 0.55
      this.beginBeat()
      return
    }
    const early = this.stroke < LATE_START
    if (early) {
      this.combo = 0
      lift = FLAP_LIFT * (0.28 + this.stroke * 0.35)
      this.call = 'Cut short'
    } else {
      const quality = clamp((this.stroke - LATE_START) / (1 - LATE_START), 0, 1)
      this.combo += 1
      lift = FLAP_LIFT * (0.7 + quality * 0.45) + Math.min(this.combo, 7) * 0.22
      this.call = this.combo > 1 ? `Climb · combo ${this.combo}` : 'Climb'
    }
    this.pendingLift += lift
    this.callTimer = 0.55
  }

  private updateBeatCue(dt: number): void {
    this.meterActive = this.flapStage !== 'idle'
    this.inWindow = this.flapStage === 'beat' && this.stroke >= LATE_START
    this.beatApproach = this.flapStage === 'beat' ? this.stroke : 0
    this.beatCue = this.inWindow ? clamp((this.stroke - LATE_START) / (1 - LATE_START), 0, 1) : 0
    this.callTimer = Math.max(0, this.callTimer - dt)
    if (this.callTimer > 0) return
    if (this.autoFlap) this.call = 'Slow air — climbing to stay aloft'
    else if (this.flapStage === 'idle') this.call = 'Hold Space to climb'
    else this.call = 'Climbing'
  }

  private animate(dt: number, input: FlightInput): void {
    if (this.walking) {
      this.lift = damp(this.lift, TUCK_LIFT, 10, dt)
      this.sweep = damp(this.sweep, -0.08, 10, dt)
      this.elbowFold = damp(this.elbowFold, 0.96, 10, dt)
    } else if (this.tuck) {
      this.lift = damp(this.lift, SPRINT.lift, 11, dt)
      this.sweep = damp(this.sweep, SPRINT.sweep, 11, dt)
      this.elbowFold = damp(this.elbowFold, SPRINT.fold, 11, dt)
    } else if (this.flapStage === 'beat') {
      const pose = this.seenApex
        ? sampleCycle(this.stroke)
        : lerpPose(GLIDE, UP, clamp((this.stroke - 0.75) / 0.25, 0, 1))
      this.lift = lerp(this.fromLift, pose.lift, this.flapBlend)
      this.sweep = lerp(this.fromSweep, pose.sweep, this.flapBlend)
      this.elbowFold = lerp(this.fromFold, pose.fold, this.flapBlend)
    } else {
      this.lift = damp(this.lift, GLIDE.lift, 4.5, dt)
      this.sweep = damp(this.sweep, GLIDE.sweep, 4.5, dt)
      this.elbowFold = damp(this.elbowFold, GLIDE.fold, 4.5, dt)
    }

    const bankAmt = this.walking ? 0 : clamp(Math.abs(this.visualRoll) / VISUAL_BANK_MAX, 0, 1)
    if (!this.walking && !this.tuck && bankAmt > 0.02) {
      const pulled = lerpPose(
        { lift: this.lift, sweep: this.sweep, fold: this.elbowFold },
        BANK,
        bankAmt,
      )
      this.lift = pulled.lift
      this.sweep = pulled.sweep
      this.elbowFold = pulled.fold
    }

    const tuck = this.walking ? 0.38 : this.tuck ? 0.72 : bankAmt * 0.44
    const bank = this.walking ? 0 : this.visualRoll
    this.leftWing.rotation.z = this.lift - bank * WING_BANK
    this.rightWing.rotation.z = -this.lift - bank * WING_BANK
    this.leftWing.rotation.x = clamp(-this.lift, 0, 0.55) * 0.18
    this.rightWing.rotation.x = clamp(-this.lift, 0, 0.55) * 0.18
    this.leftWing.rotation.y = -this.sweep - tuck + bank * 0.08
    this.rightWing.rotation.y = this.sweep + tuck + bank * 0.08

    const fold = Math.max(0, this.elbowFold)
    this.leftElbow.rotation.z = -fold
    this.rightElbow.rotation.z = fold
    this.leftElbow.rotation.y = -0.08 - fold * 0.12
    this.rightElbow.rotation.y = 0.08 + fold * 0.12
    this.leftElbow.rotation.x = fold * 0.06
    this.rightElbow.rotation.x = fold * 0.06
    this.leftTip.rotation.x = 0
    this.rightTip.rotation.x = 0
    this.leftTip.rotation.y = 0
    this.rightTip.rotation.y = 0

    const lookYaw = clamp(input.yaw * 0.28, -0.4, 0.4)
    const lookPitch = clamp(input.pitch * 0.22, -0.35, 0.35)
    this.headRig.rotation.y = damp(this.headRig.rotation.y, lookYaw, 8, dt)
    this.headRig.rotation.x = damp(this.headRig.rotation.x, -lookPitch, 8, dt)
    this.headRig.rotation.z = damp(this.headRig.rotation.z, -this.visualRoll * 0.28, 10, dt)
    this.tail.rotation.y = damp(this.tail.rotation.y, -lookYaw * 0.55, 6, dt)
    this.animateLegs(dt)
  }

  private animateLegs(dt: number): void {
    const nearLand = this.speed < LAND_SPEED && this.altitude < FEET_NEAR
    const wantFeet = this.walking || nearLand ? 1 : 0
    this.feet = damp(this.feet, wantFeet, 8, dt)
    const tucked = 1.35
    const planted = 0.12
    const base = lerp(tucked, planted, this.feet)
    const step = this.walking ? Math.sin(this.walkPhase) * 0.52 * Math.min(1, Math.abs(this.speed) / 1.4) : 0
    this.leftLeg.rotation.x = base + step
    this.rightLeg.rotation.x = base - step
    this.leftLeg.visible = this.feet > 0.04
    this.rightLeg.visible = this.feet > 0.04
  }

  private refreshFrame(planet: Planet): void {
    planet.radialUp(this.position, this.localUp)
    this.heading.addScaledVector(this.localUp, -this.heading.dot(this.localUp))
    if (this.heading.lengthSq() < 1e-8) {
      planet.tangentBasis(this.localUp, this._east, this._north)
      this.heading.copy(this._north)
    } else {
      this.heading.normalize()
    }
    this.right.crossVectors(this.localUp, this.heading).normalize()
    if (this.right.lengthSq() < 1e-8) {
      planet.tangentBasis(this.localUp, this.right, this._north)
    }
    this.forward.copy(this.heading).applyAxisAngle(this.right, -this.pitch)
    this.up.crossVectors(this.forward, this.right).normalize()
    if (this.up.dot(this.localUp) < 0) this.up.negate()
    this.right.crossVectors(this.up, this.forward).normalize()
  }

  private placeShadow(planet: Planet): void {
    planet.surfacePoint(this.position, this.shadow.position)
    planet.normalAt(this.position, this._shadowN)
    this.shadow.position.addScaledVector(this._shadowN, 0.08)
    this.shadow.quaternion.setFromUnitVectors(Z_AXIS, this._shadowN)
    const blob = this.shadow.material as MeshBasicMaterial
    blob.opacity = clamp(0.26 - this.altitude / 90, 0.04, 0.26)
    this.shadow.scale.setScalar(clamp(1.15 + this.altitude * 0.04, 1.1, 2.6))
  }

  private syncGroup(dt: number): void {
    const facePitch = this.walking ? 0.04 : this.pitch
    const visMag = lerp(VISUAL_BANK_SLOW, VISUAL_BANK_FAST, this.turnStyle)
    let faceRoll = 0
    if (!this.walking) {
      if (Math.abs(this.steer) > 0.05) {
        faceRoll = -this.steer * visMag
      } else {
        const maxPhys = lerp(MAX_BANK_SLOW, MAX_BANK_FAST, this.turnStyle)
        const commit = maxPhys > 1e-4 ? clamp(Math.abs(this.roll) / maxPhys, 0, 1) : 0
        faceRoll = Math.sign(this.roll) * visMag * commit
      }
      faceRoll = clamp(faceRoll, -VISUAL_BANK_MAX, VISUAL_BANK_MAX)
    }

    if (dt <= 0) {
      this.visualPitch = facePitch
      this.visualRoll = faceRoll
    } else {
      this.visualPitch = damp(this.visualPitch, facePitch, 14, dt)
      this.visualRoll = damp(this.visualRoll, faceRoll, 18, dt)
    }

    this._visFwd.copy(this.heading).applyAxisAngle(this.right, -this.visualPitch)
    this._visRight.crossVectors(this.localUp, this._visFwd)
    if (this._visRight.lengthSq() < 1e-8) this._visRight.copy(this.right)
    else this._visRight.normalize()
    this._visUp.crossVectors(this._visFwd, this._visRight).normalize()
    if (this._visUp.dot(this.localUp) < 0) this._visUp.negate()
    this._visUp.applyAxisAngle(this._visFwd, this.visualRoll)
    this._visRight.crossVectors(this._visUp, this._visFwd).normalize()
    this.basis.makeBasis(this._visRight, this._visUp, this._visFwd)
    this.group.quaternion.setFromRotationMatrix(this.basis)
    this.group.position.copy(this.position)
  }
}

function lerpPose(a: WingPose, b: WingPose, t: number): WingPose {
  return {
    lift: lerp(a.lift, b.lift, t),
    sweep: lerp(a.sweep, b.sweep, t),
    fold: lerp(a.fold, b.fold, t),
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function sampleCycle(t: number): WingPose {
  const poses = [UP, EARLY, POWER, LATE]
  const n = poses.length
  const x = ((t % 1) + 1) % 1 * n
  const i = Math.floor(x) % n
  const u = x - Math.floor(x)
  const a = poses[(i + n - 1) % n]
  const b = poses[i]
  const c = poses[(i + 1) % n]
  const d = poses[(i + 2) % n]
  return {
    lift: catmull(a.lift, b.lift, c.lift, d.lift, u),
    sweep: catmull(a.sweep, b.sweep, c.sweep, d.sweep, u),
    fold: Math.max(0, catmull(a.fold, b.fold, c.fold, d.fold, u)),
  }
}

/** Terrain touch sits slightly inside the analytic surface so faceted hills don't bump open air. */
const GROUND_SLACK = 0.55

function makeWing(
  sign: number,
  top: MeshLambertMaterial,
  edge: MeshLambertMaterial,
): { root: Group; elbow: Group; tip: Mesh } {
  const root = new Group()
  root.position.set(sign * 0.2, 0.08, 0.05)

  const upper = new Mesh(new ConeGeometry(0.15, 0.92, 5), top)
  upper.rotation.z = sign * Math.PI / 2
  upper.position.set(sign * 0.4, 0.02, -0.02)
  upper.scale.set(0.72, 1, 1.28)

  const elbow = new Group()
  elbow.position.set(sign * 0.86, 0.03, -0.06)

  const forearm = new Mesh(new ConeGeometry(0.11, 0.82, 5), top)
  forearm.rotation.z = sign * Math.PI / 2
  forearm.position.set(sign * 0.36, 0.01, -0.04)
  forearm.scale.set(0.52, 1, 1.22)

  const tip = new Mesh(new ConeGeometry(0.075, 0.52, 4), edge)
  tip.rotation.z = sign * Math.PI / 2
  tip.position.set(sign * 0.8, 0.05, -0.14)
  tip.scale.set(0.38, 1, 1.4)

  elbow.add(forearm, tip)
  root.add(upper, elbow)
  return { root, elbow, tip }
}

function makeLeg(sign: number, legMat: MeshLambertMaterial, footMat: MeshLambertMaterial): Group {
  const leg = new Group()
  leg.position.set(sign * 0.16, -0.18, 0.04)
  const thigh = new Mesh(new CylinderGeometry(0.035, 0.045, 0.32, 5), legMat)
  thigh.position.y = -0.14
  const foot = new Mesh(new BoxGeometry(0.08, 0.035, 0.18), footMat)
  foot.position.set(0, -0.3, 0.06)
  leg.add(thigh, foot)
  leg.visible = false
  return leg
}
