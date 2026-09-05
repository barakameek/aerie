import {
  BoxGeometry,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from 'three'
import { damp } from './math.ts'
import type { Nest } from './nest.ts'
import { fibonacciDir, type Planet } from './planet.ts'

const Y_UP = new Vector3(0, 1, 0)

const HAWK_COUNT = 16
const HAWK_SPEED = 34
const HAWK_CHASE_SPEED = 42
const HAWK_NOTICE = 110
const HAWK_GIVE_UP = 210
const HAWK_CHASE_LIMIT = 11
const HAWK_STRIKE = 3.2
const HAWK_COOLDOWN = 14
const HAWK_HEIGHT = 46
const HAWK_RING = 78

const FOX_COUNT = 3
const FOX_SPEED = 9
const FOX_DEN_SPAN = 0.075
const FOX_RAID_RANGE = 7
const FOX_SCARE_RANGE = 11
const FOX_SCARE_SPEED = 16
const FOX_FLEE_TIME = 16
const FOX_RAID_COOLDOWN = 45
const FOX_FIRST_RAID = 30

export type Threat = 'none' | 'hunted' | 'struck' | 'raid'

type Hawk = {
  pos: Vector3
  vel: Vector3
  home: Vector3
  phase: number
  cooldown: number
  chase: number
  chasing: boolean
  mesh: Group
}

type Fox = {
  pos: Vector3
  heading: Vector3
  home: Vector3
  flee: number
  cooldown: number
  mesh: Group
  step: number
}

export type WildlifeReport = {
  struck: boolean
  raided: boolean
  hunters: number
  nearestHunter: number
}

/** Hawks work the open sky; foxes work the ground under the nest. */
export class Wildlife {
  readonly group = new Group()
  hunters = 0
  private readonly hawks: Hawk[] = []
  private readonly foxes: Fox[] = []
  private readonly _a = new Vector3()
  private readonly _b = new Vector3()
  private readonly _up = new Vector3()
  private readonly _foot = new Vector3()

  constructor(planet: Planet, nest: Nest) {
    // Territories spread over the whole globe, so meeting one is an event rather than a siege.
    const dir = new Vector3()
    for (let i = 0; i < HAWK_COUNT; i++) {
      fibonacciDir(i, HAWK_COUNT, dir)
      const home = dir.clone().normalize()
      const pos = home.clone().multiplyScalar(planet.radiusAt(home) + HAWK_HEIGHT)
      const mesh = makeHawk()
      this.group.add(mesh)
      this.hawks.push({
        pos,
        vel: new Vector3(),
        home,
        phase: i * 1.7,
        cooldown: 0,
        chase: 0,
        chasing: false,
        mesh,
      })
    }

    for (let i = 0; i < FOX_COUNT; i++) {
      const home = spread(nest.pos, i + 1, FOX_COUNT, FOX_DEN_SPAN)
      const pos = home.clone().normalize().multiplyScalar(planet.radiusAt(home) + 0.4)
      const mesh = makeFox()
      this.group.add(mesh)
      const heading = new Vector3()
      const north = new Vector3()
      planet.tangentBasis(home.clone().normalize(), heading, north)
      this.foxes.push({
        pos,
        heading,
        home: home.clone().normalize(),
        flee: 0,
        cooldown: FOX_FIRST_RAID + i * 22,
        mesh,
        step: i * 2.1,
      })
    }
  }

  update(dt: number, birdPos: Vector3, birdSpeed: number, planet: Planet, nest: Nest): WildlifeReport {
    const report: WildlifeReport = { struck: false, raided: false, hunters: 0, nearestHunter: Infinity }

    for (const hawk of this.hawks) {
      const dist = hawk.pos.distanceTo(birdPos)
      if (hawk.cooldown > 0) hawk.cooldown -= dt
      const keen = hawk.cooldown <= 0 && hawk.chase < HAWK_CHASE_LIMIT
      hawk.chasing = keen && dist < (hawk.chasing ? HAWK_GIVE_UP : HAWK_NOTICE)
      if (hawk.chasing) {
        // A stoop is a burst, not a siege: it breaks off and has to reset.
        hawk.chase += dt
        report.hunters += 1
        report.nearestHunter = Math.min(report.nearestHunter, dist)
        this._a.copy(birdPos).sub(hawk.pos)
        if (this._a.lengthSq() > 1e-6) this._a.normalize()
        hawk.vel.lerp(this._a.multiplyScalar(HAWK_CHASE_SPEED), 1 - Math.exp(-2.4 * dt))
        if (dist < HAWK_STRIKE) {
          report.struck = true
          hawk.cooldown = HAWK_COOLDOWN
          hawk.chase = 0
          hawk.chasing = false
        }
      } else {
        hawk.chase = Math.max(0, hawk.chase - dt * 0.7)
        this.patrol(hawk, dt, planet)
      }

      hawk.pos.addScaledVector(hawk.vel, dt)
      this.keepAloft(hawk.pos, planet, 12)
      this.faceMotion(hawk.mesh, hawk.pos, hawk.vel)
    }

    // The spire is tall, so a fox raids by reaching its foot, not its top.
    const foot = this._foot.copy(nest.pos).normalize().multiplyScalar(planet.radiusAt(nest.pos))

    for (const fox of this.foxes) {
      const dist = fox.pos.distanceTo(birdPos)
      if (fox.flee > 0) fox.flee -= dt
      if (fox.cooldown > 0) fox.cooldown -= dt
      // A fast pass close overhead sends it running.
      if (fox.flee <= 0 && dist < FOX_SCARE_RANGE && birdSpeed > FOX_SCARE_SPEED) fox.flee = FOX_FLEE_TIME

      const hunting = fox.flee <= 0 && fox.cooldown <= 0
      const goal = this._b
      if (hunting) goal.copy(foot)
      else goal.copy(fox.home).multiplyScalar(planet.radiusAt(fox.home))

      this._a.copy(goal).sub(fox.pos)
      planet.radialUp(fox.pos, this._up)
      this._a.addScaledVector(this._up, -this._a.dot(this._up))
      const travel = this._a.length()
      if (travel > 0.6) {
        this._a.multiplyScalar(1 / travel)
        fox.heading.lerp(this._a, 1 - Math.exp(-4 * dt))
        if (fox.heading.lengthSq() > 1e-6) fox.heading.normalize()
        const pace = fox.flee > 0 ? FOX_SPEED * 1.5 : FOX_SPEED
        fox.pos.addScaledVector(fox.heading, pace * dt)
        fox.step += pace * dt
      }

      planet.placeAbove(fox.pos, 0.42)
      if (hunting && fox.pos.distanceTo(foot) < FOX_RAID_RANGE) {
        nest.raid()
        report.raided = true
        fox.cooldown = FOX_RAID_COOLDOWN
        fox.flee = 5
      }
      this.placeFox(fox, planet, dt)
    }

    this.hunters = report.hunters
    return report
  }

  private patrol(hawk: Hawk, dt: number, planet: Planet): void {
    hawk.phase += dt * 0.32
    const east = this._a
    const north = this._b
    planet.tangentBasis(hawk.home, east, north)
    const target = east
      .multiplyScalar(Math.cos(hawk.phase) * HAWK_RING)
      .addScaledVector(north, Math.sin(hawk.phase) * HAWK_RING)
      .add(hawk.home.clone().multiplyScalar(planet.radiusAt(hawk.home) + HAWK_HEIGHT))
    target.sub(hawk.pos)
    if (target.lengthSq() > 1e-6) target.normalize()
    hawk.vel.lerp(target.multiplyScalar(HAWK_SPEED), 1 - Math.exp(-1.6 * dt))
  }

  private keepAloft(pos: Vector3, planet: Planet, minAlt: number): void {
    if (planet.altitude(pos) < minAlt) planet.placeAbove(pos, minAlt, pos)
  }

  private faceMotion(mesh: Group, pos: Vector3, vel: Vector3): void {
    mesh.position.copy(pos)
    if (vel.lengthSq() < 1e-6) return
    this._up.copy(pos).normalize()
    mesh.up.copy(this._up)
    mesh.lookAt(this._a.copy(pos).add(vel))
  }

  private placeFox(fox: Fox, planet: Planet, dt: number): void {
    fox.mesh.position.copy(fox.pos)
    planet.radialUp(fox.pos, this._up)
    fox.mesh.up.copy(this._up)
    fox.mesh.lookAt(this._a.copy(fox.pos).add(fox.heading))
    const legs = fox.mesh.userData.legs as Mesh[] | undefined
    if (!legs) return
    for (let i = 0; i < legs.length; i++) {
      const swing = Math.sin(fox.step * 2.4 + i * Math.PI * 0.5) * 0.5
      legs[i].rotation.x = damp(legs[i].rotation.x, swing, 14, dt)
    }
  }
}

function spread(around: Vector3, i: number, n: number, spanRad: number): Vector3 {
  const axis = around.clone().normalize()
  const east = new Vector3()
  const north = new Vector3()
  const ref = Math.abs(axis.y) > 0.94 ? new Vector3(1, 0, 0) : Y_UP
  east.crossVectors(ref, axis).normalize()
  north.crossVectors(axis, east).normalize()
  const angle = (i / n) * Math.PI * 2 + i * 0.9
  const span = spanRad * (0.55 + ((i * 37) % 100) / 160)
  return axis
    .clone()
    .addScaledVector(east, Math.cos(angle) * span)
    .addScaledVector(north, Math.sin(angle) * span)
    .normalize()
}

function makeHawk(): Group {
  const hawk = new Group()
  const dark = new MeshLambertMaterial({ color: '#4a3b2e', flatShading: true })
  const pale = new MeshLambertMaterial({ color: '#8d7a5e', flatShading: true })
  const beakMat = new MeshLambertMaterial({ color: '#e0b247', flatShading: true })

  const body = new Mesh(new IcosahedronGeometry(0.72, 0), dark)
  body.scale.set(0.6, 0.55, 1.5)
  const head = new Mesh(new IcosahedronGeometry(0.3, 0), dark)
  head.position.set(0, 0.16, 0.86)
  const beak = new Mesh(new ConeGeometry(0.1, 0.3, 4), beakMat)
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, 0.1, 1.14)

  for (const sign of [1, -1]) {
    const wing = new Mesh(new ConeGeometry(0.32, 2.5, 4), pale)
    wing.rotation.z = (sign * Math.PI) / 2
    wing.rotation.y = -sign * 0.18
    wing.position.set(sign * 1.35, 0.1, -0.05)
    wing.scale.set(0.42, 1, 1.5)
    hawk.add(wing)
  }
  const tail = new Mesh(new ConeGeometry(0.34, 0.9, 4), pale)
  tail.rotation.x = -Math.PI / 2
  tail.position.set(0, 0.04, -1.05)
  tail.scale.set(1.3, 0.4, 1)

  hawk.add(body, head, beak, tail)
  return hawk
}

function makeFox(): Group {
  const fox = new Group()
  const fur = new MeshLambertMaterial({ color: '#c2612a', flatShading: true })
  const pale = new MeshLambertMaterial({ color: '#e8dcc6', flatShading: true })
  const dark = new MeshLambertMaterial({ color: '#2c211a', flatShading: true })

  const body = new Mesh(new BoxGeometry(0.5, 0.42, 1.15), fur)
  body.position.y = 0.52
  const head = new Mesh(new BoxGeometry(0.4, 0.36, 0.4), fur)
  head.position.set(0, 0.66, 0.7)
  const snout = new Mesh(new ConeGeometry(0.15, 0.36, 4), pale)
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, 0.6, 0.98)
  const tail = new Mesh(new ConeGeometry(0.22, 0.95, 5), fur)
  tail.rotation.x = -Math.PI / 2.6
  tail.position.set(0, 0.62, -0.78)

  for (const sign of [1, -1]) {
    const ear = new Mesh(new ConeGeometry(0.11, 0.26, 4), dark)
    ear.position.set(sign * 0.14, 0.9, 0.66)
    fox.add(ear)
  }

  const legs: Mesh[] = []
  for (const [lx, lz] of [[0.19, 0.42], [-0.19, 0.42], [0.19, -0.4], [-0.19, -0.4]] as const) {
    const hip = new Mesh(new BoxGeometry(0.13, 0.46, 0.15), dark)
    hip.position.set(lx, -0.23, 0)
    const leg = new Mesh(new BoxGeometry(0.001, 0.001, 0.001), dark)
    leg.position.set(0, 0.5, lz)
    leg.add(hip)
    legs.push(leg)
    fox.add(leg)
  }

  fox.add(body, head, snout, tail)
  fox.userData.legs = legs
  return fox
}
