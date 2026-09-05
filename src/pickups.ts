import {
  BoxGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from 'three'
import { fibonacciDir, type Planet } from './planet.ts'

export type PickupKind = 'twig' | 'berry'

type Item = {
  pos: Vector3
  up: Vector3
  kind: PickupKind
  slot: number
  respawn: number
}

const Y_UP = new Vector3(0, 1, 0)
const RESPAWN = 26
const CELL = 60

/** Twigs and berries lying on the ground, picked up by flying through them. */
export class Pickups {
  readonly group = new Group()
  private readonly items: Item[] = []
  private readonly buckets = new Map<string, number[]>()
  private readonly twigs: InstancedMesh
  private readonly berries: InstancedMesh
  private readonly dummy = new Object3D()
  private readonly dirty = new Set<number>()

  constructor(planet: Planet) {
    const placements = scatter(planet)
    let twigCount = 0
    let berryCount = 0
    for (const item of placements) {
      item.slot = item.kind === 'twig' ? twigCount++ : berryCount++
      this.items.push(item)
    }

    this.twigs = makeInstances(new BoxGeometry(2.4, 0.24, 0.24), '#c69a5c', twigCount)
    this.berries = makeInstances(new IcosahedronGeometry(0.95, 0), '#d8324b', berryCount)
    this.group.add(this.twigs, this.berries)

    for (let i = 0; i < this.items.length; i++) {
      const key = cellKey(this.items[i].pos)
      const list = this.buckets.get(key)
      if (list) list.push(i)
      else this.buckets.set(key, [i])
      this.draw(this.items[i])
    }
    this.twigs.instanceMatrix.needsUpdate = true
    this.berries.instanceMatrix.needsUpdate = true
  }

  update(dt: number): void {
    this.dirty.clear()
    for (const item of this.items) {
      if (item.respawn <= 0) continue
      item.respawn -= dt
      if (item.respawn <= 0) {
        item.respawn = 0
        this.draw(item)
        this.dirty.add(item.kind === 'twig' ? 0 : 1)
      }
    }
    if (this.dirty.has(0)) this.twigs.instanceMatrix.needsUpdate = true
    if (this.dirty.has(1)) this.berries.instanceMatrix.needsUpdate = true
  }

  /** Takes the closest available item of the wanted kind within reach. */
  collect(pos: Vector3, reach: number, want?: PickupKind): PickupKind | null {
    let best: Item | null = null
    let bestDist = reach * reach
    const cx = Math.floor(pos.x / CELL)
    const cy = Math.floor(pos.y / CELL)
    const cz = Math.floor(pos.z / CELL)

    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = this.buckets.get(`${ix}:${iy}:${iz}`)
          if (!list) continue
          for (const index of list) {
            const item = this.items[index]
            if (item.respawn > 0) continue
            if (want && item.kind !== want) continue
            const d = item.pos.distanceToSquared(pos)
            if (d < bestDist) {
              bestDist = d
              best = item
            }
          }
        }
      }
    }

    if (!best) return null
    best.respawn = RESPAWN
    this.hide(best)
    if (best.kind === 'twig') this.twigs.instanceMatrix.needsUpdate = true
    else this.berries.instanceMatrix.needsUpdate = true
    return best.kind
  }

  private draw(item: Item): void {
    const mesh = item.kind === 'twig' ? this.twigs : this.berries
    this.dummy.position.copy(item.pos)
    this.dummy.quaternion.setFromUnitVectors(Y_UP, item.up)
    this.dummy.rotateY(item.slot * 1.7)
    this.dummy.scale.setScalar(1)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(item.slot, this.dummy.matrix)
  }

  private hide(item: Item): void {
    const mesh = item.kind === 'twig' ? this.twigs : this.berries
    this.dummy.position.copy(item.pos)
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(item.slot, this.dummy.matrix)
  }
}

function cellKey(pos: Vector3): string {
  return `${Math.floor(pos.x / CELL)}:${Math.floor(pos.y / CELL)}:${Math.floor(pos.z / CELL)}`
}

function makeInstances(
  geo: BoxGeometry | IcosahedronGeometry,
  color: string,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(
    geo,
    new MeshLambertMaterial({ color: new Color(color), flatShading: true }),
    Math.max(count, 1),
  )
  mesh.frustumCulled = false
  return mesh
}

function scatter(planet: Planet): Item[] {
  const items: Item[] = []
  const dir = new Vector3()
  const up = new Vector3()
  const samples = 13000

  for (let i = 0; i < samples; i++) {
    fibonacciDir(i, samples, dir)
    const biome = planet.biomeAt(dir)
    if (biome === 'ocean') continue
    const elev = planet.elevationAt(dir)
    if (elev < 0.6) continue
    if (planet.slopeAt(dir) > 0.85) continue

    const roll = hash(i * 13 + 5)
    // Twigs come from woodland floors; berries like the greener, lower ground.
    const twiggy = biome === 'forest' || biome === 'mountain' || biome === 'snow'
    const kind: PickupKind = twiggy ? (roll < 0.62 ? 'twig' : 'berry') : roll < 0.34 ? 'twig' : 'berry'
    if (biome === 'desert' && roll > 0.5) continue
    if (biome === 'snow' && roll > 0.7) continue

    planet.normalAt(dir, up)
    // Lifted clear of the grass so they read from the air and can be snatched in a pass.
    const pos = dir.clone().multiplyScalar(planet.radiusAt(dir) + (kind === 'twig' ? 0.9 : 1.8))
    items.push({ pos, up: up.clone(), kind, slot: 0, respawn: 0 })
  }

  return items
}

function hash(n: number): number {
  const x = Math.sin(n * 78.233 + 12.9898) * 43758.5453
  return x - Math.floor(x)
}
