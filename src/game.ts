import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { Bird, SPRINT_CAP_DEFAULT, SPRINT_CAP_MAX, SPRINT_CAP_MIN } from './bird.ts'
import { ChaseCamera } from './cameraRig.ts'
import { Forest } from './forest.ts'
import { HitDebug } from './hitDebug.ts'
import { Input } from './input.ts'
import { Noise2D } from './noise.ts'
import { clamp, damp } from './math.ts'
import { Nest, TWIGS_NEEDED, type Chick } from './nest.ts'
import { Pickups, type PickupKind } from './pickups.ts'
import { Planet, type Biome } from './planet.ts'
import { Sky, SUN_DIR } from './sky.ts'
import { Wildlife } from './wildlife.ts'

const PICKUP_REACH = 9
const NEST_REACH = 14

export type HudState = {
  speed: number
  altitude: number
  locked: boolean
  combo: number
  beatCue: number
  beatApproach: number
  inWindow: boolean
  meterActive: boolean
  tucked: boolean
  autoFlap: boolean
  pitch: number
  yaw: number
  roll: number
  visRoll: number
  turnStyle: number
  sprintCap: number
  call: string
  biome: Biome
  hit: number
  carrying: PickupKind | null
  twigs: number
  twigsNeeded: number
  nestBuilt: boolean
  chicks: Chick[]
  fledged: number
  broods: number
  nestRange: number
  nestBearing: number
  hunters: number
  danger: number
  notice: string
}

export class Game {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly input = new Input()
  readonly bird = new Bird()
  readonly camera = new ChaseCamera()
  private readonly sky: Sky

  readonly planet: Planet
  private readonly forest: Forest
  readonly nest: Nest
  private readonly pickups: Pickups
  private readonly wildlife: Wildlife
  private readonly hitDebug: HitDebug | null
  private lastTime = 0
  private running = false
  private readonly spawn = new Vector3()
  private carrying: PickupKind | null = null
  private carryMesh: Mesh | null = null
  private notice = ''
  private noticeTimer = 0
  private danger = 0
  private readonly _toNest = new Vector3()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor('#87c4d0')
    this.renderer.toneMappingExposure = 1.05

    this.scene.background = new Color('#7fbdd0')
    this.scene.fog = new Fog('#9ec9d4', 160, 1180)

    const sun = new DirectionalLight('#ffe6b8', 1.22)
    sun.position.copy(SUN_DIR).multiplyScalar(400)
    const fill = new DirectionalLight('#6a88aa', 0.28)
    fill.position.copy(SUN_DIR).multiplyScalar(-220)
    const ambient = new AmbientLight('#6d8094', 0.3)
    this.sky = new Sky()
    this.scene.add(sun, fill, ambient, this.sky.group)

    const noise = new Noise2D(19)
    this.planet = new Planet(noise)
    this.forest = new Forest(noise, this.planet)
    this.scene.add(this.planet.mesh, this.planet.water, this.planet.rocks)
    this.scene.add(...this.forest.layers())

    this.nest = new Nest(this.planet)
    this.pickups = new Pickups(this.planet)
    this.wildlife = new Wildlife(this.planet, this.nest)
    this.scene.add(this.nest.group, this.pickups.group, this.wildlife.group)

    const params = new URLSearchParams(location.search)
    this.hitDebug = params.get('hitboxes') === '1' ? new HitDebug() : null
    if (this.hitDebug) this.scene.add(this.hitDebug.group)

    if (params.get('atnest') === '1') this.spawnOnApproach()
    else this.pickSpawn()
    this.bird.spawn(this.spawn.x, this.spawn.y, this.spawn.z, this.yawToNest())
    this.bird.alignToPlanet(this.planet)
    this.bird.setSprintCap(loadSprintCap())
    const startSpeed = Number(params.get('speed'))
    if (Number.isFinite(startSpeed) && startSpeed > 0) this.bird.speed = clamp(startSpeed, 1, SPRINT_CAP_MAX)
    const startAlt = Number(params.get('alt'))
    if (Number.isFinite(startAlt) && startAlt > 0) {
      this.planet.placeAbove(this.bird.position, this.planet.altitude(this.bird.position) + startAlt)
    }
    const agl = Number(params.get('agl'))
    if (Number.isFinite(agl) && agl > 0) this.planet.placeAbove(this.bird.position, agl)
    const startPitch = Number(params.get('pitch'))
    if (Number.isFinite(startPitch)) this.bird.pitch = clamp(startPitch, -1.52, 0.82)
    if (params.get('walk') === '1') {
      this.bird.walking = true
      this.bird.speed = 0
      this.bird.airSpeed = 0
      this.bird.pitch = 0.02
      this.planet.placeAbove(this.bird.position, 0.78)
    }
    if (params.get('skim') === '1') this.placeBesideTree(false)
    if (params.get('trunk') === '1') this.placeBesideTree(true)
    const brood = Number(params.get('brood'))
    if (Number.isFinite(brood) && brood > 0) {
      for (let i = 0; i < Math.min(brood, TWIGS_NEEDED); i++) this.nest.deliver('twig')
    }
    this.bird.alignToPlanet(this.planet)
    this.scene.add(this.bird.group, this.bird.shadow)
    this.camera.snap(this.bird, this.planet)
    this.sky.update(this.camera.camera.position, this.bird.localUp)

    this.input.attach(canvas)
    this.onResize()
    window.addEventListener('resize', this.onResize)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    requestAnimationFrame(this.tick)
  }

  hud(): HudState {
    return {
      speed: this.bird.airSpeed,
      altitude: this.bird.altitude,
      locked: this.input.locked,
      combo: this.bird.combo,
      beatCue: this.bird.beatCue,
      beatApproach: this.bird.beatApproach,
      inWindow: this.bird.inWindow,
      meterActive: this.bird.meterActive,
      tucked: this.bird.tuck,
      autoFlap: this.bird.autoFlap,
      pitch: this.bird.pitch,
      yaw: this.bird.yaw,
      roll: this.bird.roll,
      visRoll: this.bird.visualRoll,
      turnStyle: this.bird.turnStyle,
      sprintCap: this.bird.sprintCap,
      call: this.bird.call,
      biome: this.planet.biomeAt(this.bird.position),
      hit: this.bird.hitDepth,
      carrying: this.carrying,
      twigs: this.nest.twigs,
      twigsNeeded: TWIGS_NEEDED,
      nestBuilt: this.nest.built,
      chicks: this.nest.chicks,
      fledged: this.nest.fledgedCount,
      broods: this.nest.broods,
      nestRange: this.bird.position.distanceTo(this.nest.pos),
      nestBearing: this.bearingToNest(),
      hunters: this.wildlife.hunters,
      danger: this.danger,
      notice: this.notice,
    }
  }

  /** Angle from the bird's nose to the nest, for the HUD needle. */
  private bearingToNest(): number {
    this._toNest.copy(this.nest.pos).sub(this.bird.position)
    this._toNest.addScaledVector(this.bird.localUp, -this._toNest.dot(this.bird.localUp))
    if (this._toNest.lengthSq() < 1e-8) return 0
    this._toNest.normalize()
    return Math.atan2(this._toNest.dot(this.bird.right), this._toNest.dot(this.bird.heading))
  }

  private tick = (time: number): void => {
    if (!this.running) return
    const dt = Math.min(0.033, (time - this.lastTime) / 1000)
    this.lastTime = time
    this.update(dt)
    this.renderer.render(this.scene, this.camera.camera)
    requestAnimationFrame(this.tick)
  }

  private update(dt: number): void {
    const input = this.input.sample()
    this.bird.update(dt, input, this.planet, this.forest)
    this.updateNesting(dt)
    this.camera.update(dt, this.bird, this.planet, input)
    this.sky.update(this.camera.camera.position, this.bird.localUp)
    this.hitDebug?.sync(this.bird.position, this.forest, this.bird.position)
  }

  private updateNesting(dt: number): void {
    this.pickups.update(dt)
    this.nest.update(dt)
    this.noticeTimer = Math.max(0, this.noticeTimer - dt)
    if (this.noticeTimer === 0) this.notice = ''

    const report = this.wildlife.update(dt, this.bird.position, this.bird.airSpeed, this.planet, this.nest)
    const closing = report.hunters > 0 ? clamp(1 - report.nearestHunter / 150, 0, 1) : 0
    this.danger = damp(this.danger, closing, 4, dt)

    if (report.struck) {
      this.bird.stagger(0.45, 'A hawk hit you')
      if (this.carrying) {
        this.setCarry(null)
        this.say('The hawk knocked it out of your beak')
      } else {
        this.say('A hawk struck — shake it off')
      }
    } else if (report.raided) {
      this.say(this.nest.built ? 'A fox is at the nest!' : 'A fox dragged a twig away')
    }

    if (!this.carrying) {
      // Only take what the nest can use, so you can never fill your beak with the wrong thing.
      const want: PickupKind = this.nest.built ? 'berry' : 'twig'
      const found = this.pickups.collect(this.bird.position, PICKUP_REACH, want)
      if (found) {
        this.setCarry(found)
        this.say(found === 'twig' ? 'Twig — take it to the nest' : 'Berry — feed a chick')
      }
      return
    }

    if (this.bird.position.distanceTo(this.nest.pos) > NEST_REACH) return
    const result = this.nest.deliver(this.carrying)
    // Anything the nest cannot use gets left on the rim rather than stuck in your beak.
    this.setCarry(null)
    if (result === 'nest-full' || result === 'no-chick') {
      this.say(result === 'nest-full' ? 'The nest is already built' : 'No chick needs feeding')
      return
    }
    if (result === 'twig') {
      this.say(
        this.nest.built
          ? 'Nest finished — the chicks have hatched'
          : `Twig laid · ${this.nest.twigs}/${TWIGS_NEEDED}`,
      )
    } else if (this.nest.chicks.every((c) => c.fledged)) {
      this.say('The whole brood has fledged! Build again')
    } else {
      this.say('Chick fed')
    }
  }

  private say(text: string): void {
    this.notice = text
    this.noticeTimer = 2.6
  }

  private setCarry(kind: PickupKind | null): void {
    this.carrying = kind
    if (this.carryMesh) {
      this.bird.carryRig.remove(this.carryMesh)
      this.carryMesh.geometry.dispose()
      this.carryMesh = null
    }
    if (!kind) return
    this.carryMesh =
      kind === 'twig'
        ? new Mesh(
            new BoxGeometry(1.5, 0.14, 0.14),
            new MeshLambertMaterial({ color: '#b08a52', flatShading: true }),
          )
        : new Mesh(
            new IcosahedronGeometry(0.24, 0),
            new MeshLambertMaterial({ color: '#c8324b', flatShading: true }),
          )
    this.bird.carryRig.add(this.carryMesh)
  }

  private placeBesideTree(intoTrunk: boolean): void {
    const east = new Vector3()
    const north = new Vector3()
    let best = this.forest.trees[0]
    let bestDist = 1e9
    for (const tree of this.forest.trees) {
      const d = tree.pos.distanceToSquared(this.bird.position)
      if (d < bestDist) {
        bestDist = d
        best = tree
      }
    }
    if (!best) return
    this.planet.tangentBasis(best.up, east, north)
    const along = intoTrunk ? best.foliageBase * 0.55 : best.foliageBase + best.height * 0.22
    const radial = intoTrunk ? Math.max(0.08, best.trunkHit * 0.35) : best.canopy * 1.12
    this.bird.position.copy(best.pos)
    this.bird.position.addScaledVector(best.up, along)
    this.bird.position.addScaledVector(east, radial)
    this.bird.speed = intoTrunk ? 8 : 16
    this.bird.airSpeed = this.bird.speed
    this.bird.pitch = 0
    this.bird.markRest()
  }

  /** Face the spire on the first frame, so the beacon is the first thing you see. */
  private yawToNest(): number {
    const up = new Vector3()
    const east = new Vector3()
    const north = new Vector3()
    this.planet.radialUp(this.spawn, up)
    this.planet.tangentBasis(up, east, north)
    const toNest = this.nest.pos.clone().sub(this.spawn)
    toNest.addScaledVector(up, -toNest.dot(up))
    if (toNest.lengthSq() < 1e-8) return 0
    toNest.normalize()
    return Math.atan2(toNest.dot(east), toNest.dot(north))
  }

  /** Debug start: lined up on the spire so the nest is straight ahead. */
  private spawnOnApproach(): void {
    const up = this.nest.pos.clone().normalize()
    const east = new Vector3()
    const north = new Vector3()
    this.planet.tangentBasis(up, east, north)
    this.spawn.copy(this.nest.pos).addScaledVector(east, -34).addScaledVector(up, 4)
  }

  /** Start within sight of the nest so the first flight has somewhere to go. */
  private pickSpawn(): void {
    const axis = this.nest.pos.clone().normalize()
    const east = new Vector3()
    const north = new Vector3()
    this.planet.tangentBasis(axis, east, north)

    const dir = new Vector3()
    const best = axis.clone()
    let bestScore = -1e9

    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2
      const span = 0.12 + (i % 4) * 0.02
      dir
        .copy(axis)
        .addScaledVector(east, Math.cos(angle) * span)
        .addScaledVector(north, Math.sin(angle) * span)
        .normalize()
      const biome = this.planet.biomeAt(dir)
      if (biome === 'ocean') continue
      if (this.planet.elevationAt(dir) < 1) continue
      const pos = dir.clone().multiplyScalar(this.planet.radiusAt(dir))
      const trees = this.forest.query(pos, 18)
      const score =
        (biome === 'forest' ? 14 : biome === 'beach' ? 6 : biome === 'desert' ? 8 : 2) -
        trees.length * 3 -
        this.planet.slopeAt(dir) * 25
      if (score > bestScore) {
        bestScore = score
        best.copy(dir)
      }
    }
    this.planet.placeAbove(best, 42, this.spawn)
  }

  private onResize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.resize(width, height)
  }

  setSprintCap(value: number): void {
    this.bird.setSprintCap(value)
    saveSprintCap(this.bird.sprintCap)
  }
}

const SPRINT_KEY = 'aerie.sprintCap'

function loadSprintCap(): number {
  try {
    const raw = localStorage.getItem(SPRINT_KEY)
    if (raw == null) return SPRINT_CAP_DEFAULT
    return clamp(Number(raw), SPRINT_CAP_MIN, SPRINT_CAP_MAX)
  } catch {
    return SPRINT_CAP_DEFAULT
  }
}

function saveSprintCap(value: number): void {
  try {
    localStorage.setItem(SPRINT_KEY, String(value))
  } catch {
    /* private mode */
  }
}
