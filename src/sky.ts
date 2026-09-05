import {
  BackSide,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { SEA_LEVEL } from './planet.ts'

const Y_UP = new Vector3(0, 1, 0)
export const SUN_DIR = new Vector3(0.42, 0.62, 0.26).normalize()

const DOME_RADIUS = 1500

export class Sky {
  readonly group = new Group()
  private readonly dome: Mesh
  private readonly sun: Mesh

  constructor() {
    this.dome = createDome()
    this.sun = createSun()
    this.group.add(this.dome, this.sun, createClouds())
  }

  update(origin: Vector3, up: Vector3): void {
    this.dome.position.copy(origin)
    this.dome.quaternion.setFromUnitVectors(Y_UP, up)
    // The sun rides with the dome so it never ends up behind the sky or inside the planet.
    this.sun.position.copy(origin).addScaledVector(SUN_DIR, DOME_RADIUS * 0.82)
  }
}

function createDome(): Mesh {
  const radius = DOME_RADIUS
  const skyGeo = new SphereGeometry(radius, 28, 18)
  const colors = new Float32Array(skyGeo.attributes.position.count * 3)
  const zenith = new Color('#3d8ec8')
  const horizon = new Color('#f0c89a')
  const low = new Color('#7eb8c8')
  const mix = new Color()

  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / radius
    if (y > 0.08) mix.copy(horizon).lerp(zenith, Math.min(1, (y - 0.08) / 0.7))
    else mix.copy(horizon).lerp(low, clamp01((-y + 0.08) / 0.4))
    colors[i * 3] = mix.r
    colors[i * 3 + 1] = mix.g
    colors[i * 3 + 2] = mix.b
  }
  skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return new Mesh(
    skyGeo,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  )
}

function createSun(): Mesh {
  const sun = new Mesh(
    new IcosahedronGeometry(64, 1),
    new MeshBasicMaterial({ color: '#fff3c4', fog: false }),
  )
  sun.position.copy(SUN_DIR).multiplyScalar(DOME_RADIUS * 0.82)
  return sun
}

function createClouds(): InstancedMesh {
  const dummy = new Object3D()
  const puffs: { pos: Vector3; s: number }[] = []
  const dir = new Vector3()

  const clusters = 170
  for (let c = 0; c < clusters; c++) {
    const y = 1 - (c / (clusters - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = Math.PI * (3 - Math.sqrt(5)) * c * 2.7
    dir.set(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize()
    if (hash(c * 19) < 0.22) continue
    // High enough to sit at the top of the climb, so they read as ceiling rather than debris.
    const radius = SEA_LEVEL + 132 + hash(c * 11) * 62
    const cx = dir.x * radius
    const cy = dir.y * radius
    const cz = dir.z * radius
    const n = 3 + Math.floor(hash(c * 7) * 4)
    for (let i = 0; i < n; i++) {
      puffs.push({
        pos: new Vector3(
          cx + (hash(c * 50 + i) - 0.5) * 22,
          cy + (hash(c * 17 + i * 3) - 0.5) * 8,
          cz + (hash(c * 23 + i * 5) - 0.5) * 16,
        ),
        s: 8 + hash(c * 3 + i) * 12,
      })
    }
  }

  const mesh = new InstancedMesh(
    new IcosahedronGeometry(1, 0),
    new MeshLambertMaterial({ color: '#fffdf7', emissive: '#c9d8e6', flatShading: true }),
    Math.max(puffs.length, 1),
  )
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i]
    dummy.position.copy(p.pos)
    dummy.lookAt(0, 0, 0)
    dummy.rotateX(hash(i * 2) * 1.2)
    dummy.rotateZ(hash(i * 5) * 0.8)
    dummy.scale.set(p.s * 1.3, p.s * 0.5, p.s)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
