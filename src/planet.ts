import {
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { clamp, lerp, smoothstep } from './math.ts'
import { Noise2D } from './noise.ts'

export const SEA_LEVEL = 472
export const PEAK_HEIGHT = 54

export const PEAK_DIR = new Vector3(-0.41, 0.36, 0.84).normalize()
export const SPAWN_DIR = new Vector3(0.58, 0.32, 0.75).normalize()
export const DESERT_DIR = new Vector3(0.22, 0.06, -0.97).normalize()

export type Biome = 'ocean' | 'beach' | 'desert' | 'forest' | 'mountain' | 'snow'

export const BIOME_LABEL: Record<Biome, string> = {
  ocean: 'Ocean',
  beach: 'Coast',
  desert: 'Desert',
  forest: 'Forest',
  mountain: 'Peaks',
  snow: 'Tundra',
}

const WORLD_X = new Vector3(1, 0, 0)
const WORLD_Y = new Vector3(0, 1, 0)
const WORLD_Z = new Vector3(0, 0, 1)

const _dir = new Vector3()
const _east = new Vector3()
const _north = new Vector3()
const _p0 = new Vector3()
const _pE = new Vector3()
const _pN = new Vector3()
const _delta = new Vector3()
const _tint = new Color()

export class Planet {
  readonly mesh: Mesh
  readonly water: Mesh
  readonly rocks: InstancedMesh
  readonly noise: Noise2D

  constructor(noise: Noise2D) {
    this.noise = noise

    const geometry = new SphereGeometry(1, 264, 132)
    const pos = geometry.attributes.position
    const colors = new Float32Array(pos.count * 3)

    for (let i = 0; i < pos.count; i++) {
      _dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
      const elev = sampleElevation(noise, _dir)
      const radius = Number.isFinite(elev) ? SEA_LEVEL + elev : SEA_LEVEL
      pos.setXYZ(i, _dir.x * radius, _dir.y * radius, _dir.z * radius)
      tintAt(noise, _dir, elev, _tint)
      colors[i * 3] = _tint.r
      colors[i * 3 + 1] = _tint.g
      colors[i * 3 + 2] = _tint.b
    }

    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    this.mesh = new Mesh(
      geometry,
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    )

    this.water = new Mesh(
      new SphereGeometry(SEA_LEVEL + 0.18, 144, 72),
      new MeshLambertMaterial({
        color: '#2f8aa8',
        transparent: true,
        opacity: 0.78,
        flatShading: true,
      }),
    )

    this.rocks = scatterRocks(noise, this)
  }

  radiusAt(dir: Vector3): number {
    _dir.copy(dir).normalize()
    return SEA_LEVEL + sampleElevation(this.noise, _dir)
  }

  elevationAt(dir: Vector3): number {
    _dir.copy(dir).normalize()
    return sampleElevation(this.noise, _dir)
  }

  altitude(pos: Vector3): number {
    const len = pos.length()
    if (len < 1e-6) return SEA_LEVEL
    return len - this.radiusAt(pos)
  }

  radialUp(pos: Vector3, out: Vector3): Vector3 {
    if (pos.lengthSq() < 1e-8) return out.copy(WORLD_Y)
    return out.copy(pos).normalize()
  }

  surfacePoint(pos: Vector3, out: Vector3): Vector3 {
    if (pos.lengthSq() < 1e-8) return out.copy(SPAWN_DIR).multiplyScalar(SEA_LEVEL)
    out.copy(pos).normalize()
    return out.multiplyScalar(this.radiusAt(out))
  }

  placeAbove(pos: Vector3, agl: number, out: Vector3 = pos): Vector3 {
    if (pos.lengthSq() < 1e-8) return out.copy(SPAWN_DIR).multiplyScalar(SEA_LEVEL + agl)
    out.copy(pos).normalize()
    return out.multiplyScalar(this.radiusAt(out) + agl)
  }

  normalAt(pos: Vector3, out: Vector3): Vector3 {
    _dir.copy(pos)
    if (_dir.lengthSq() < 1e-8) return out.copy(WORLD_Y)
    _dir.normalize()
    this.tangentBasis(_dir, _east, _north)
    const eps = 0.0045
    const r0 = this.radiusAt(_dir)
    _p0.copy(_dir).multiplyScalar(r0)
    _pE.copy(_dir).addScaledVector(_east, eps).normalize()
    _pE.multiplyScalar(this.radiusAt(_pE))
    _pN.copy(_dir).addScaledVector(_north, eps).normalize()
    _pN.multiplyScalar(this.radiusAt(_pN))
    out.subVectors(_pE, _p0).cross(_delta.subVectors(_pN, _p0))
    if (out.dot(_dir) < 0) out.negate()
    if (out.lengthSq() < 1e-10) return out.copy(_dir)
    return out.normalize()
  }

  biomeAt(pos: Vector3): Biome {
    _dir.copy(pos).normalize()
    return classifyBiome(this.noise, _dir, sampleElevation(this.noise, _dir))
  }

  slopeAt(dir: Vector3): number {
    _dir.copy(dir).normalize()
    this.tangentBasis(_dir, _east, _north)
    const eps = 0.01
    const r0 = this.radiusAt(_dir)
    _pE.copy(_dir).addScaledVector(_east, eps).normalize()
    _pN.copy(_dir).addScaledVector(_north, eps).normalize()
    const dE = this.radiusAt(_pE) - r0
    const dN = this.radiusAt(_pN) - r0
    return clamp(Math.hypot(dE, dN) / (eps * r0), 0, 2)
  }

  tangentBasis(up: Vector3, east: Vector3, north: Vector3): void {
    const ref = Math.abs(up.y) > 0.94 ? WORLD_X : WORLD_Y
    east.crossVectors(ref, up)
    if (east.lengthSq() < 1e-10) east.crossVectors(WORLD_Z, up)
    east.normalize()
    north.crossVectors(up, east).normalize()
  }
}

// Terrain detail is pinned to world size, so doubling the radius yields more hills
// and ridges at their familiar scale rather than the same few stretched flat.
const DETAIL = 2

export function sampleElevation(noise: Noise2D, dir: Vector3): number {
  const land = landMask(noise, dir)
  const hills = noise.fbm(dir.x * 3.15 * DETAIL + 1.2, dir.z * 3.15 * DETAIL - 0.4, 4) * 7.4
  const rumple = noise.fbm(dir.y * 6.8 * DETAIL + 2.1, dir.x * 6.8 * DETAIL, 3) * 2.15
  const ridges = clamp(noise.ridge(dir.x * 3.7 * DETAIL + 20, dir.z * 3.7 * DETAIL, 4), 0, 1)
  const mtnGate = noise.fbm(dir.y * 2.2 * DETAIL + 9, dir.x * 2.2 * DETAIL - 4, 3)
  const mountains = ridges ** 1.45 * clamp(mtnGate + 0.28, 0, 1) * 24 * land
  const peak = Math.exp(-(((1 - dir.dot(PEAK_DIR)) / 0.0155) ** 2)) * PEAK_HEIGHT
  const polar = smoothstep(0.62, 0.9, Math.abs(dir.y)) * 4.4

  if (land < 0.05) return -7.5 + rumple * 0.35
  const h = lerp(-1.8, 5.2 + hills + rumple + polar, land) + mountains + peak
  return Number.isFinite(h) ? h : 0
}

export function classifyBiome(noise: Noise2D, dir: Vector3, elev: number): Biome {
  if (elev < 0.28) return elev < -0.85 ? 'ocean' : 'beach'
  const absLat = Math.abs(Math.asin(clamp(dir.y, -1, 1)))
  const dry = dryness(noise, dir)
  if (elev > 26 || absLat > 0.98) return 'snow'
  if (elev > 12.5) return 'mountain'
  if (dir.dot(DESERT_DIR) > 0.52) return 'desert'
  if (absLat < 0.5 && dry > 0.22) return 'desert'
  if (dry > 0.55 && absLat < 0.78) return 'desert'
  return 'forest'
}

function landMask(noise: Noise2D, dir: Vector3): number {
  const a = noise.fbm(dir.x * 1.52 + 4.2, dir.z * 1.52 - 1.1, 5)
  const b = noise.fbm(dir.y * 1.75 + 8.8, dir.x * 1.32 + 2.3, 4)
  const c = noise.fbm(dir.z * 1.38 - 3.3, dir.y * 1.38 + 6.1, 4)
  let m = a * 0.48 + b * 0.32 + c * 0.2 + 0.2
  m = Math.max(m, smoothstep(0.58, 0.86, Math.abs(dir.y)))
  m = Math.max(m, smoothstep(0.78, 0.93, Math.max(0, dir.dot(PEAK_DIR))) * 0.94)
  m = Math.max(m, smoothstep(0.74, 0.92, Math.max(0, dir.dot(SPAWN_DIR))))
  m = Math.max(m, smoothstep(0.7, 0.9, Math.max(0, dir.dot(DESERT_DIR))) * 0.9)
  return smoothstep(0.14, 0.44, m)
}

function tintAt(noise: Noise2D, dir: Vector3, elev: number, out: Color): Color {
  const ocean = new Color('#1c5c6e')
  const shallows = new Color('#2f8f8a')
  const sand = new Color('#d7c48a')
  const desert = new Color('#c9a05a')
  const dune = new Color('#e0b86a')
  const grass = new Color('#6db24a')
  const meadow = new Color('#8fd15c')
  const rock = new Color('#8a7a68')
  const stone = new Color('#9a8b7a')
  const snow = new Color('#e8e4dc')
  const ice = new Color('#d5e4ee')

  if (elev < -0.4) {
    const t = clamp((-elev - 0.4) / 8, 0, 1)
    return out.copy(shallows).lerp(ocean, t)
  }

  const absLat = Math.abs(Math.asin(clamp(dir.y, -1, 1)))
  const dry = dryness(noise, dir)
  const slope = ridgeSlope(noise, dir)

  const beachW = smoothstep(1.6, 0.15, elev) * smoothstep(-0.6, 0.2, elev)
  const snowW = clamp(
    smoothstep(20, 32, elev) + smoothstep(0.82, 1.08, absLat) * smoothstep(0.4, 4, elev),
    0,
    1,
  )
  const mtnW = clamp(smoothstep(9, 16, elev) + slope * 0.6, 0, 1) * (1 - snowW)
  const desertW =
    clamp(
      Math.max(
        smoothstep(0.78, 0.38, absLat) * smoothstep(0.12, 0.42, dry),
        smoothstep(0.48, 0.72, dir.dot(DESERT_DIR)),
      ),
      0,
      1,
    ) *
    (1 - mtnW) *
    (1 - snowW)
  const forestW = clamp(1 - beachW - desertW - mtnW - snowW, 0, 1)

  out.set('#000000')
  addMix(out, sand, beachW)
  addMix(out, desert.clone().lerp(dune, clamp(dry, 0, 1)), desertW)
  addMix(out, meadow.clone().lerp(grass, 0.55 + noise.value(dir.x * 8, dir.z * 8) * 0.2), forestW)
  addMix(out, rock.clone().lerp(stone, clamp((elev - 14) / 16, 0, 1)), mtnW)
  addMix(out, snow.clone().lerp(ice, smoothstep(0.9, 1.3, absLat)), snowW)
  const w = beachW + desertW + forestW + mtnW + snowW
  if (w > 1e-5) out.multiplyScalar(1 / w)
  else out.copy(grass)
  return out
}

function addMix(into: Color, color: Color, weight: number): void {
  if (weight <= 0) return
  into.r += color.r * weight
  into.g += color.g * weight
  into.b += color.b * weight
}

function dryness(noise: Noise2D, dir: Vector3): number {
  return noise.fbm(dir.x * 2.05 * DETAIL + 40, dir.z * 2.05 * DETAIL, 4)
}

function ridgeSlope(noise: Noise2D, dir: Vector3): number {
  return clamp(noise.ridge(dir.x * 3.7 * DETAIL + 20, dir.z * 3.7 * DETAIL, 3), 0, 1)
}

function scatterRocks(noise: Noise2D, planet: Planet): InstancedMesh {
  const dummy = new Object3D()
  const placements: { pos: Vector3; up: Vector3; s: number }[] = []
  const dir = new Vector3()
  const up = new Vector3()

  for (let i = 0; i < 3200; i++) {
    fibonacciDir(i, 3200, dir)
    const elev = sampleElevation(noise, dir)
    const biome = classifyBiome(noise, dir, elev)
    if (biome !== 'mountain' && biome !== 'snow' && biome !== 'desert') continue
    if (biome === 'desert' && hash(i * 7 + 3) > 0.18) continue
    if (planet.slopeAt(dir) < 0.12 && biome !== 'desert') continue
    planet.normalAt(dir, up)
    const pos = dir.clone().multiplyScalar(planet.radiusAt(dir) - 0.15)
    placements.push({ pos, up: up.clone(), s: 1.05 + hash(i * 11) * 2.6 })
  }

  const mesh = new InstancedMesh(
    new IcosahedronGeometry(0.7, 0),
    new MeshLambertMaterial({ color: '#8d7f6d', flatShading: true }),
    Math.max(placements.length, 1),
  )

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]
    dummy.position.copy(p.pos).addScaledVector(p.up, p.s * 0.28)
    dummy.quaternion.setFromUnitVectors(WORLD_Y, p.up)
    dummy.rotateY(hash(i * 13) * Math.PI * 2)
    dummy.rotateX((hash(i * 3) - 0.5) * 0.5)
    dummy.scale.set(p.s, p.s * (0.55 + hash(i) * 0.7), p.s)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

export function fibonacciDir(i: number, n: number, out: Vector3): Vector3 {
  const y = 1 - (i / Math.max(n - 1, 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = Math.PI * (3 - Math.sqrt(5)) * i
  return out.set(Math.cos(theta) * r, y, Math.sin(theta) * r)
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
