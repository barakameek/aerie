import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
} from 'three'
import { clamp } from './math.ts'
import { fibonacciDir, SPAWN_DIR, type Planet } from './planet.ts'
import type { PickupKind } from './pickups.ts'

const Y_UP = new Vector3(0, 1, 0)

export const TWIGS_NEEDED = 6
export const CHICK_COUNT = 3
export const FEEDS_TO_FLEDGE = 4

const HUNGER_RATE = 1 / 115
const STARVE_GRACE = 22
const SPIRE_HEIGHT = 15

export type Chick = {
  fed: number
  hunger: number
  starving: number
  fledged: boolean
}

export type Delivery = 'twig' | 'fed' | 'nest-full' | 'no-chick' | 'none'

/** The nest on its spire: twigs build it, berries raise the chicks in it. */
export class Nest {
  readonly group = new Group()
  readonly pos = new Vector3()
  readonly up = new Vector3()
  readonly chicks: Chick[] = []
  twigs = 0
  fledgedCount = 0
  broods = 0

  private readonly twigRing = new Group()
  private readonly chickRig = new Group()
  private readonly chickMeshes: Group[] = []
  private bob = 0

  constructor(planet: Planet) {
    const dir = pickSite(planet)
    const ground = planet.radiusAt(dir)
    planet.normalAt(dir, this.up)
    this.pos.copy(dir).multiplyScalar(ground + SPIRE_HEIGHT)

    const base = dir.clone().multiplyScalar(ground - 1)
    this.group.position.copy(base)
    this.group.quaternion.setFromUnitVectors(Y_UP, this.up)
    const beacon = makeBeacon()
    beacon.position.y = SPIRE_HEIGHT + 1
    this.group.add(makeSpire(), beacon, this.twigRing, this.chickRig)
    this.twigRing.position.y = SPIRE_HEIGHT + 1
    this.chickRig.position.y = SPIRE_HEIGHT + 1.5
  }

  get built(): boolean {
    return this.twigs >= TWIGS_NEEDED
  }

  get hungriest(): Chick | null {
    let worst: Chick | null = null
    for (const chick of this.chicks) {
      if (chick.fledged) continue
      if (!worst || chick.hunger > worst.hunger) worst = chick
    }
    return worst
  }

  deliver(kind: PickupKind): Delivery {
    if (kind === 'twig') {
      if (this.built) return 'nest-full'
      this.twigs += 1
      this.addTwig(this.twigs - 1)
      if (this.built) this.hatch()
      return 'twig'
    }

    const chick = this.hungriest
    if (!chick) return 'no-chick'
    chick.hunger = 0
    chick.starving = 0
    chick.fed += 1
    if (chick.fed >= FEEDS_TO_FLEDGE) {
      chick.fledged = true
      this.fledgedCount += 1
      if (this.chicks.every((c) => c.fledged)) this.reset()
    }
    return 'fed'
  }

  /** A fox that reaches the spire takes a twig, or frightens a chick off its food. */
  raid(): void {
    if (!this.built) {
      if (this.twigs > 0) {
        this.twigs -= 1
        this.removeTwig()
      }
      return
    }
    const target = this.chicks.find((c) => !c.fledged)
    if (!target) return
    target.hunger = 1
    target.fed = Math.max(0, target.fed - 1)
  }

  update(dt: number): void {
    this.bob += dt
    for (const chick of this.chicks) {
      if (chick.fledged) continue
      chick.hunger = clamp(chick.hunger + HUNGER_RATE * dt, 0, 1)
      if (chick.hunger >= 1) {
        chick.starving += dt
        if (chick.starving >= STARVE_GRACE) {
          chick.starving = 0
          chick.fed = Math.max(0, chick.fed - 1)
        }
      } else {
        chick.starving = 0
      }
    }
    this.animate()
  }

  private hatch(): void {
    for (let i = 0; i < CHICK_COUNT; i++) {
      this.chicks.push({ fed: 0, hunger: 0.25, starving: 0, fledged: false })
      const chick = makeChick()
      const angle = (i / CHICK_COUNT) * Math.PI * 2
      chick.position.set(Math.cos(angle) * 0.85, 0, Math.sin(angle) * 0.85)
      chick.rotation.y = -angle
      this.chickRig.add(chick)
      this.chickMeshes.push(chick)
    }
  }

  private reset(): void {
    this.broods += 1
    this.twigs = 0
    this.chicks.length = 0
    this.twigRing.clear()
    this.chickRig.clear()
    this.chickMeshes.length = 0
  }

  private addTwig(index: number): void {
    const twig = new Mesh(
      new BoxGeometry(2.3, 0.22, 0.22),
      new MeshLambertMaterial({ color: index % 2 ? '#8a6a42' : '#a3814f', flatShading: true }),
    )
    const angle = (index / TWIGS_NEEDED) * Math.PI * 2
    twig.position.set(Math.cos(angle) * 1.15, index * 0.12, Math.sin(angle) * 1.15)
    twig.rotation.y = -angle + Math.PI / 2
    twig.rotation.z = 0.12
    this.twigRing.add(twig)
  }

  private removeTwig(): void {
    const last = this.twigRing.children[this.twigRing.children.length - 1]
    if (last) this.twigRing.remove(last)
  }

  private animate(): void {
    for (let i = 0; i < this.chickMeshes.length; i++) {
      const chick = this.chicks[i]
      const mesh = this.chickMeshes[i]
      if (!chick || !mesh) continue
      mesh.visible = !chick.fledged
      // Hungrier chicks beg harder.
      const eager = 1.4 + chick.hunger * 5
      mesh.position.y = Math.abs(Math.sin(this.bob * eager + i)) * (0.1 + chick.hunger * 0.34)
      mesh.rotation.x = Math.sin(this.bob * eager + i) * chick.hunger * 0.3
    }
  }
}

function pickSite(planet: Planet): Vector3 {
  const dir = new Vector3()
  const best = SPAWN_DIR.clone()
  let bestScore = -1e9

  for (let i = 0; i < 4000; i++) {
    fibonacciDir(i, 4000, dir)
    const toSpawn = dir.dot(SPAWN_DIR)
    // Roughly 150-260 units out: a real trip, but findable on the first flight.
    if (toSpawn < 0.852 || toSpawn > 0.95) continue
    const biome = planet.biomeAt(dir)
    if (biome === 'ocean' || biome === 'snow') continue
    const elev = planet.elevationAt(dir)
    if (elev < 2) continue
    const score = elev - planet.slopeAt(dir) * 40
    if (score > bestScore) {
      bestScore = score
      best.copy(dir)
    }
  }
  return best.normalize()
}

/** A soft column over the spire: without it the nest is one crag among many. */
function makeBeacon(): Mesh {
  const height = 150
  const beacon = new Mesh(
    new CylinderGeometry(1.4, 5.2, height, 8, 1, true),
    new MeshBasicMaterial({
      color: '#ffca7a',
      transparent: true,
      opacity: 0.26,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    }),
  )
  beacon.position.y = height * 0.5
  beacon.renderOrder = 3
  return beacon
}

function makeSpire(): Group {
  const spire = new Group()
  const stone = new MeshLambertMaterial({ color: '#8d8071', flatShading: true })
  const mossy = new MeshLambertMaterial({ color: '#7c8a63', flatShading: true })

  const base = new Mesh(new ConeGeometry(4.6, 7, 6, 1), stone)
  base.position.y = 3.5
  const shaft = new Mesh(new CylinderGeometry(2.05, 3.1, 8.5, 6, 1), stone)
  shaft.position.y = 9.4
  shaft.rotation.y = 0.4
  const cap = new Mesh(new CylinderGeometry(2.7, 2.05, 2.2, 6, 1), mossy)
  cap.position.y = 14.5
  cap.rotation.y = 0.8
  spire.add(base, shaft, cap)
  return spire
}

function makeChick(): Group {
  const chick = new Group()
  const down = new MeshLambertMaterial({ color: '#e8d59a', flatShading: true })
  const beakMat = new MeshLambertMaterial({ color: '#e8913f', flatShading: true })
  const eyeMat = new MeshLambertMaterial({ color: '#241b14', flatShading: true })

  const body = new Mesh(new IcosahedronGeometry(0.42, 0), down)
  body.scale.set(0.85, 0.95, 0.85)
  const head = new Mesh(new IcosahedronGeometry(0.26, 0), down)
  head.position.set(0, 0.42, 0.06)
  const beak = new Mesh(new ConeGeometry(0.1, 0.26, 4), beakMat)
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, 0.4, 0.3)
  const eye = new Mesh(new IcosahedronGeometry(0.05, 0), eyeMat)
  eye.position.set(0.13, 0.48, 0.16)
  const eye2 = eye.clone()
  eye2.position.x = -0.13
  chick.add(body, head, beak, eye, eye2)
  return chick
}
