import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Forest, TreeCollider } from './forest.ts'

const Y_UP = new Vector3(0, 1, 0)
const dummy = new Object3D()

/** Wireframe overlay of nearby tree cores. Enable with `?hitboxes=1`. */
export class HitDebug {
  readonly group = new Group()
  private readonly mat = new MeshBasicMaterial({
    color: '#ff5a3a',
    wireframe: true,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  })
  private readonly bodyMat = new MeshBasicMaterial({
    color: '#5ad0ff',
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  })
  private readonly cylGeo = new CylinderGeometry(1, 1, 1, 6, 1, true)
  private readonly coneGeo = new ConeGeometry(1, 1, 6, 1, true)
  private readonly sphGeo = new SphereGeometry(1, 8, 6)
  private readonly pool: Mesh[] = []
  private used = 0
  private readonly body: Mesh

  constructor() {
    this.group.renderOrder = 20
    this.body = new Mesh(new SphereGeometry(0.34, 8, 6), this.bodyMat)
    this.group.add(this.body)
  }

  sync(origin: Vector3, forest: Forest, bodyPos: Vector3): void {
    this.used = 0
    this.body.position.copy(bodyPos)
    const nearby = forest.query(origin, 36)
    for (const tree of nearby) this.drawTree(tree)
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false
  }

  private drawTree(tree: TreeCollider): void {
    this.place(tree, this.cylGeo, tree.foliageBase * 0.5, tree.trunkHit, tree.foliageBase, tree.trunkHit)
    for (const shell of tree.shells) {
      const h = shell.y1 - shell.y0
      this.place(tree, this.coneGeo, (shell.y0 + shell.y1) * 0.5, shell.r0, h, shell.r0)
    }
    for (const blob of tree.blobs) {
      this.place(tree, this.sphGeo, blob.along, blob.radius, blob.radius, blob.radius)
    }
  }

  private place(
    tree: TreeCollider,
    geo: CylinderGeometry | ConeGeometry | SphereGeometry,
    along: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    const mesh = this.take(geo)
    dummy.position.copy(tree.pos).addScaledVector(tree.up, along)
    dummy.quaternion.setFromUnitVectors(Y_UP, tree.up)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    mesh.matrix.copy(dummy.matrix)
  }

  private take(geo: CylinderGeometry | ConeGeometry | SphereGeometry): Mesh {
    let mesh = this.pool[this.used]
    if (!mesh) {
      mesh = new Mesh(geo, this.mat)
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      this.pool.push(mesh)
      this.group.add(mesh)
    } else {
      mesh.geometry = geo
    }
    this.used += 1
    mesh.visible = true
    return mesh
  }
}
