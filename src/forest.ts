import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from 'three'
import { Noise2D } from './noise.ts'
import { fibonacciDir, type Biome, type Planet } from './planet.ts'

export type TreeKind = 'pine' | 'oak' | 'thin'

export type CrownShell = {
  y0: number
  y1: number
  r0: number
  r1: number
}

export type CrownBlob = {
  along: number
  radius: number
}

export type TreeCollider = {
  pos: Vector3
  up: Vector3
  kind: TreeKind
  biome: Biome
  trunk: number
  canopy: number
  height: number
  foliageBase: number
  trunkHit: number
  shells: CrownShell[]
  blobs: CrownBlob[]
}

const Y_UP = new Vector3(0, 1, 0)

export class Forest {
  readonly trunks: InstancedMesh
  readonly pineLow: InstancedMesh
  readonly pineHigh: InstancedMesh
  readonly oakLow: InstancedMesh
  readonly oakHigh: InstancedMesh
  readonly thinLow: InstancedMesh
  readonly thinHigh: InstancedMesh
  readonly trees: TreeCollider[] = []

  private readonly cellSize = 22
  private readonly buckets = new Map<string, number[]>()

  constructor(noise: Noise2D, planet: Planet) {
    const placements = plantTrees(noise, planet)
    this.trees = placements

    for (let i = 0; i < placements.length; i++) {
      const key = this.cellKey(placements[i].pos)
      const list = this.buckets.get(key)
      if (list) list.push(i)
      else this.buckets.set(key, [i])
    }

    const pines = placements.filter((tree) => tree.kind === 'pine')
    const oaks = placements.filter((tree) => tree.kind === 'oak')
    const thins = placements.filter((tree) => tree.kind === 'thin')

    this.trunks = makeInstances(
      new CylinderGeometry(0.22, 0.3, 1, 5, 1),
      '#6a4a32',
      placements.length,
    )
    this.pineLow = makeInstances(new ConeGeometry(1, 0.92, 6, 1), '#2f7a38', pines.length)
    this.pineHigh = makeInstances(new ConeGeometry(0.72, 0.78, 5, 1), '#3d8a40', pines.length)
    this.oakLow = makeInstances(new IcosahedronGeometry(1, 0), '#4b9a3d', oaks.length)
    this.oakHigh = makeInstances(new IcosahedronGeometry(0.72, 0), '#6aab36', oaks.length)
    this.thinLow = makeInstances(new ConeGeometry(1, 1.05, 5, 1), '#7aad3a', thins.length)
    this.thinHigh = makeInstances(new ConeGeometry(0.55, 0.82, 4, 1), '#c4b24a', thins.length)

    const dummy = new Object3D()
    let pineI = 0
    let oakI = 0
    let thinI = 0
    const bark = [new Color('#6a4a32'), new Color('#5a3d28'), new Color('#7a5a3a')]

    for (let i = 0; i < placements.length; i++) {
      const tree = placements[i]
      const trunkH = tree.foliageBase
      const yaw = hash(i * 51 + 2) * Math.PI * 2
      const leanX = (hash(i * 9) - 0.5) * 0.08
      const leanZ = (hash(i * 21) - 0.5) * 0.08

      dummy.position.copy(tree.pos).addScaledVector(tree.up, trunkH * 0.5)
      dummy.quaternion.setFromUnitVectors(Y_UP, tree.up)
      dummy.rotateY(yaw)
      dummy.rotateX(leanX)
      dummy.rotateZ(leanZ)
      dummy.scale.set(tree.trunk / 0.26, trunkH, tree.trunk / 0.26)
      dummy.updateMatrix()
      this.trunks.setMatrixAt(i, dummy.matrix)
      this.trunks.setColorAt(i, barkColor(tree, bark, i))

      if (tree.kind === 'pine') {
        placePine(dummy, tree, leanX, leanZ, yaw, false)
        this.pineLow.setMatrixAt(pineI, dummy.matrix)
        this.pineLow.setColorAt(pineI, pineShade(tree, i, false))
        placePine(dummy, tree, leanX, leanZ, yaw, true)
        this.pineHigh.setMatrixAt(pineI, dummy.matrix)
        this.pineHigh.setColorAt(pineI, pineShade(tree, i, true))
        pineI += 1
      } else if (tree.kind === 'oak') {
        placeOak(dummy, tree, leanX, leanZ, yaw, false)
        this.oakLow.setMatrixAt(oakI, dummy.matrix)
        this.oakLow.setColorAt(oakI, oakShade(tree, i, false))
        placeOak(dummy, tree, leanX, leanZ, yaw, true)
        this.oakHigh.setMatrixAt(oakI, dummy.matrix)
        this.oakHigh.setColorAt(oakI, oakShade(tree, i, true))
        oakI += 1
      } else {
        placeThin(dummy, tree, leanX, leanZ, yaw, false)
        this.thinLow.setMatrixAt(thinI, dummy.matrix)
        this.thinLow.setColorAt(thinI, thinShade(tree, i, false))
        placeThin(dummy, tree, leanX, leanZ, yaw, true)
        this.thinHigh.setMatrixAt(thinI, dummy.matrix)
        this.thinHigh.setColorAt(thinI, thinShade(tree, i, true))
        thinI += 1
      }
    }

    this.trunks.instanceMatrix.needsUpdate = true
    if (this.trunks.instanceColor) this.trunks.instanceColor.needsUpdate = true
    for (const mesh of [this.pineLow, this.pineHigh, this.oakLow, this.oakHigh, this.thinLow, this.thinHigh]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  layers(): InstancedMesh[] {
    return [this.trunks, this.pineLow, this.pineHigh, this.oakLow, this.oakHigh, this.thinLow, this.thinHigh]
  }

  query(pos: Vector3, radius: number): TreeCollider[] {
    const minX = pos.x - radius
    const maxX = pos.x + radius
    const minY = pos.y - radius
    const maxY = pos.y + radius
    const minZ = pos.z - radius
    const maxZ = pos.z + radius
    const x0 = Math.floor(minX / this.cellSize)
    const x1 = Math.floor(maxX / this.cellSize)
    const y0 = Math.floor(minY / this.cellSize)
    const y1 = Math.floor(maxY / this.cellSize)
    const z0 = Math.floor(minZ / this.cellSize)
    const z1 = Math.floor(maxZ / this.cellSize)
    const found: TreeCollider[] = []
    const seen = new Set<number>()

    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const list = this.buckets.get(`${ix}:${iy}:${iz}`)
          if (!list) continue
          for (const index of list) {
            if (seen.has(index)) continue
            seen.add(index)
            const tree = this.trees[index]
            if (tree.pos.distanceToSquared(pos) > radius * radius) continue
            found.push(tree)
          }
        }
      }
    }
    return found
  }

  private cellKey(pos: Vector3): string {
    return `${Math.floor(pos.x / this.cellSize)}:${Math.floor(pos.y / this.cellSize)}:${Math.floor(pos.z / this.cellSize)}`
  }
}

export function treeHitRadius(tree: TreeCollider): number {
  let r = tree.trunkHit
  for (const shell of tree.shells) r = Math.max(r, shell.r0, shell.r1)
  for (const blob of tree.blobs) r = Math.max(r, blob.radius)
  return r
}

export function treeHitTop(tree: TreeCollider): number {
  let top = tree.foliageBase
  for (const shell of tree.shells) top = Math.max(top, shell.y1)
  for (const blob of tree.blobs) top = Math.max(top, blob.along + blob.radius)
  return top
}

function makeInstances(
  geo: ConeGeometry | CylinderGeometry | IcosahedronGeometry,
  color: string,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(
    geo,
    new MeshLambertMaterial({ color, flatShading: true }),
    Math.max(count, 1),
  )
  mesh.frustumCulled = false
  return mesh
}

function placeAlong(
  dummy: Object3D,
  tree: TreeCollider,
  along: number,
  yaw: number,
  leanX: number,
  leanZ: number,
  sx: number,
  sy: number,
  sz: number,
  shiftX = 0,
): void {
  dummy.position.copy(tree.pos).addScaledVector(tree.up, along)
  dummy.quaternion.setFromUnitVectors(Y_UP, tree.up)
  dummy.rotateY(yaw)
  dummy.rotateX(leanX)
  dummy.rotateZ(leanZ)
  if (shiftX !== 0) dummy.translateX(shiftX)
  dummy.scale.set(sx, sy, sz)
  dummy.updateMatrix()
}

type ConeFit = { along: number; half: number; radius: number; sy: number }

function pineCone(tree: TreeCollider, tip: boolean): ConeFit {
  const sy = tree.height * (tip ? 0.34 : 0.4)
  const geoH = tip ? 0.78 : 0.92
  const half = (geoH * 0.5) * sy
  let along = tree.foliageBase + half - half * 0.22
  if (tip) {
    const low = pineCone(tree, false)
    along = low.along + low.half - half * 0.4
  }
  return { along, half, radius: tree.canopy * (tip ? 0.62 : 1), sy }
}

function thinCone(tree: TreeCollider, tip: boolean): ConeFit {
  const sy = tree.height * (tip ? 0.36 : 0.48)
  const geoH = tip ? 0.82 : 1.05
  const half = (geoH * 0.5) * sy
  let along = tree.foliageBase + half - half * 0.22
  if (tip) {
    const low = thinCone(tree, false)
    along = low.along + low.half - half * 0.4
  }
  return { along, half, radius: tree.canopy * (tip ? 0.52 : 1), sy }
}

function oakBlob(tree: TreeCollider, upper: boolean): { along: number; radiusX: number; radiusY: number } {
  const sy = tree.height * (upper ? 0.4 : 0.52)
  const along = upper ? tree.foliageBase + sy * 1.05 : tree.foliageBase + sy * 0.82
  const w = tree.canopy * (upper ? 0.74 : 1)
  return { along, radiusX: w, radiusY: sy }
}

function insetCone(fit: ConeFit, scale: number): CrownShell {
  const r = fit.radius * scale
  return {
    y0: fit.along - fit.half,
    y1: fit.along + fit.half,
    r0: r,
    r1: r * 0.06,
  }
}

function placePine(
  dummy: Object3D,
  tree: TreeCollider,
  leanX: number,
  leanZ: number,
  yaw: number,
  tip: boolean,
): void {
  const fit = pineCone(tree, tip)
  placeAlong(dummy, tree, fit.along, yaw + (tip ? 0.45 : 0.2), leanX, leanZ, fit.radius, fit.sy, fit.radius)
}

function placeOak(
  dummy: Object3D,
  tree: TreeCollider,
  leanX: number,
  leanZ: number,
  yaw: number,
  upper: boolean,
): void {
  const blob = oakBlob(tree, upper)
  placeAlong(
    dummy,
    tree,
    blob.along,
    yaw + (upper ? 0.8 : 0.15),
    leanX * 0.4,
    leanZ * 0.4,
    blob.radiusX,
    blob.radiusY,
    blob.radiusX,
    upper ? tree.canopy * 0.1 : 0,
  )
}

function placeThin(
  dummy: Object3D,
  tree: TreeCollider,
  leanX: number,
  leanZ: number,
  yaw: number,
  tip: boolean,
): void {
  const fit = thinCone(tree, tip)
  placeAlong(dummy, tree, fit.along, yaw + (tip ? 0.4 : 0), leanX * 0.5, leanZ * 0.5, fit.radius, fit.sy, fit.radius)
}

function plantTrees(noise: Noise2D, planet: Planet): TreeCollider[] {
  const trees: TreeCollider[] = []
  const dir = new Vector3()
  const up = new Vector3()
  const samples = 18000

  for (let i = 0; i < samples; i++) {
    fibonacciDir(i, samples, dir)
    const elev = planet.elevationAt(dir)
    const biome = planet.biomeAt(dir)
    if (!acceptTree(biome, elev, planet.slopeAt(dir), hash(i * 19 + 4))) continue

    const kind = pickKind(biome, hash(i * 31 + 8))
    const spacing = kind === 'oak' ? 9.2 : kind === 'pine' ? 7.4 : 6.2
    const pos = dir.clone().multiplyScalar(planet.radiusAt(dir))
    if (tooClose(trees, pos, spacing)) continue

    planet.normalAt(dir, up)
    const size = 0.72 + hash(i * 11) * 0.7
    const scale = biomeScale(biome)
    const foliage = (8.5 + size * 6.5 + noise.value(dir.x * 12, dir.z * 12) * 1.4) * 1.5 * scale
    const trunkH = (2.3 + size * 1.15) * 4.5 * scale

    trees.push(makeTree(pos, up.clone(), kind, biome, size, foliage, trunkH))
  }

  return trees
}

function acceptTree(biome: Biome, elev: number, slope: number, roll: number): boolean {
  if (biome === 'ocean') return false
  if (elev < 0.45) return false
  if (slope > 0.92) return false
  if (biome === 'forest') return roll > 0.08
  if (biome === 'mountain') return roll > 0.62
  if (biome === 'snow') return roll > 0.78
  if (biome === 'desert') return roll > 0.86
  if (biome === 'beach') return roll > 0.9
  return false
}

function pickKind(biome: Biome, roll: number): TreeKind {
  if (biome === 'desert' || biome === 'beach') return 'thin'
  if (biome === 'snow' || biome === 'mountain') return roll < 0.82 ? 'pine' : 'thin'
  if (roll < 0.34) return 'pine'
  if (roll < 0.74) return 'oak'
  return 'thin'
}

function biomeScale(biome: Biome): number {
  if (biome === 'desert') return 0.42
  if (biome === 'snow') return 0.7
  if (biome === 'mountain') return 0.82
  if (biome === 'beach') return 0.55
  return 1
}

const TRUNK_HIT = 0.78
const CONE_HIT = 0.7
const OAK_HIT = 0.72

function makeTree(
  pos: Vector3,
  up: Vector3,
  kind: TreeKind,
  biome: Biome,
  size: number,
  foliage: number,
  trunkH: number,
): TreeCollider {
  const tree: TreeCollider = kind === 'pine'
    ? {
        pos,
        up,
        kind,
        biome,
        trunk: 0.42 + size * 0.2,
        canopy: 6.4 + size * 3.4,
        height: foliage * 1.05,
        foliageBase: trunkH,
        trunkHit: 0,
        shells: [],
        blobs: [],
      }
    : kind === 'oak'
      ? {
          pos,
          up,
          kind,
          biome,
          trunk: 0.52 + size * 0.28,
          canopy: 9.2 + size * 4.4,
          height: foliage * 0.78,
          foliageBase: trunkH,
          trunkHit: 0,
          shells: [],
          blobs: [],
        }
      : {
          pos,
          up,
          kind,
          biome,
          trunk: 0.28 + size * 0.14,
          canopy: 4.6 + size * 2.4,
          height: foliage * 0.92,
          foliageBase: trunkH,
          trunkHit: 0,
          shells: [],
          blobs: [],
        }

  tree.trunkHit = tree.trunk * TRUNK_HIT
  if (kind === 'oak') {
    const low = oakBlob(tree, false)
    const high = oakBlob(tree, true)
    tree.blobs = [
      { along: low.along, radius: Math.min(low.radiusX, low.radiusY) * OAK_HIT },
      { along: high.along, radius: Math.min(high.radiusX, high.radiusY) * OAK_HIT * 0.92 },
    ]
  } else if (kind === 'pine') {
    tree.shells = [insetCone(pineCone(tree, false), CONE_HIT), insetCone(pineCone(tree, true), CONE_HIT)]
  } else {
    tree.shells = [insetCone(thinCone(tree, false), CONE_HIT), insetCone(thinCone(tree, true), CONE_HIT)]
  }
  return tree
}

function tooClose(trees: TreeCollider[], pos: Vector3, spacing: number): boolean {
  const start = Math.max(0, trees.length - 48)
  for (let i = start; i < trees.length; i++) {
    if (trees[i].pos.distanceToSquared(pos) < spacing * spacing) return true
  }
  return false
}

function barkColor(tree: TreeCollider, bark: Color[], i: number): Color {
  if (tree.biome === 'snow') return new Color('#7a6e62')
  if (tree.biome === 'desert') return new Color('#8a6a3c')
  return bark[i % bark.length]
}

function pineShade(tree: TreeCollider, i: number, tip: boolean): Color {
  const t = hash(i * 29 + 3)
  if (tree.biome === 'snow') {
    return tip
      ? new Color().setHSL(0.34 + t * 0.03, 0.22, 0.52 + t * 0.08)
      : new Color().setHSL(0.36 + t * 0.03, 0.28, 0.38 + t * 0.06)
  }
  if (tree.biome === 'mountain') {
    return tip
      ? new Color().setHSL(0.32 + t * 0.03, 0.36, 0.3 + t * 0.06)
      : new Color().setHSL(0.34 + t * 0.03, 0.4, 0.2 + t * 0.05)
  }
  return tip
    ? new Color().setHSL(0.33 + t * 0.04, 0.48, 0.34 + t * 0.08)
    : new Color().setHSL(0.36 + t * 0.03, 0.52, 0.22 + t * 0.06)
}

function oakShade(tree: TreeCollider, i: number, upper: boolean): Color {
  const t = hash(i * 33 + 7)
  if (tree.biome === 'desert') {
    return upper
      ? new Color().setHSL(0.12 + t * 0.04, 0.48, 0.48 + t * 0.08)
      : new Color().setHSL(0.14 + t * 0.04, 0.42, 0.38 + t * 0.06)
  }
  return upper
    ? new Color().setHSL(0.22 + t * 0.06, 0.62, 0.42 + t * 0.1)
    : new Color().setHSL(0.28 + t * 0.05, 0.55, 0.32 + t * 0.08)
}

function thinShade(tree: TreeCollider, i: number, tip: boolean): Color {
  const t = hash(i * 41 + 11)
  if (tree.biome === 'desert' || tree.biome === 'beach') {
    return tip
      ? new Color().setHSL(0.1 + t * 0.04, 0.48, 0.55 + t * 0.08)
      : new Color().setHSL(0.12 + t * 0.04, 0.4, 0.4 + t * 0.08)
  }
  if (tree.biome === 'snow') {
    return tip
      ? new Color().setHSL(0.18 + t * 0.04, 0.22, 0.58 + t * 0.08)
      : new Color().setHSL(0.22 + t * 0.04, 0.28, 0.42 + t * 0.06)
  }
  return tip
    ? new Color().setHSL(0.14 + t * 0.04, 0.55, 0.52 + t * 0.1)
    : new Color().setHSL(0.24 + t * 0.05, 0.42, 0.4 + t * 0.1)
}

function hash(n: number): number {
  const x = Math.sin(n * 91.345 + 17.13) * 23421.631
  return x - Math.floor(x)
}
