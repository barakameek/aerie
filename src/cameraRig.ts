import { PerspectiveCamera, Vector3 } from 'three'
import type { Bird } from './bird.ts'
import type { FlightInput } from './input.ts'
import { clamp, damp } from './math.ts'
import type { Planet } from './planet.ts'

const FOLLOW = 4.4
const LOOK = 6.8
const DISTANCE = 11.5
const HEIGHT = 3.6
const LOOK_AHEAD = 8.4
const LOW_ALTITUDE = 14
const LOW_LIFT = 5.8
const HIGH_START = 26
const HIGH_FULL = 58
const HIGH_LIFT = 9.2

export class ChaseCamera {
  readonly camera: PerspectiveCamera
  private readonly desired = new Vector3()
  private readonly look = new Vector3()
  private readonly smoothLook = new Vector3()
  private readonly offset = new Vector3()
  private readonly viewDir = new Vector3()
  private readonly skyUp = new Vector3()
  private groundLift = 0
  private highLift = 0
  private orbitYaw = 0
  private orbitPitch = 0
  private primed = false

  constructor() {
    this.camera = new PerspectiveCamera(62, 1, 0.25, 2600)
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
  }

  snap(bird: Bird, planet: Planet): void {
    this.orbitYaw = 0
    this.orbitPitch = 0
    this.place(bird, this.desired, this.look)
    this.keepAbove(this.desired, planet, 2.4)
    this.camera.position.copy(this.desired)
    this.smoothLook.copy(this.look)
    this.aimUpright(bird)
    this.primed = true
  }

  update(dt: number, bird: Bird, planet: Planet, input: FlightInput): void {
    const nearGround = clamp((LOW_ALTITUDE - bird.altitude) / 10, 0, 1)
    const highUp = clamp((bird.altitude - HIGH_START) / (HIGH_FULL - HIGH_START), 0, 1)
    this.groundLift = damp(this.groundLift, nearGround, 6, dt)
    this.highLift = damp(this.highLift, highUp, 4.5, dt)
    if (input.freeLook) {
      this.orbitYaw -= input.mouseYaw * 0.0055
      this.orbitPitch = clamp(this.orbitPitch - input.mousePitch * 0.0042, -1.05, 0.72)
    } else {
      this.orbitYaw = damp(this.orbitYaw, 0, 12, dt)
      this.orbitPitch = damp(this.orbitPitch, 0, 12, dt)
      if (Math.abs(this.orbitYaw) < 0.002) this.orbitYaw = 0
      if (Math.abs(this.orbitPitch) < 0.002) this.orbitPitch = 0
    }

    this.place(bird, this.desired, this.look)
    this.keepAbove(this.desired, planet, 2.4)

    if (!this.primed) {
      this.camera.position.copy(this.desired)
      this.smoothLook.copy(this.look)
      this.primed = true
    } else {
      const returning = !input.freeLook && (this.orbitYaw !== 0 || this.orbitPitch !== 0)
      const follow = input.freeLook ? 11 : returning ? 8 : FOLLOW
      const lookRate = input.freeLook ? 12 : returning ? 10 : LOOK
      const posK = 1 - Math.exp(-follow * dt)
      const lookK = 1 - Math.exp(-lookRate * dt)
      this.camera.position.lerp(this.desired, posK)
      this.smoothLook.lerp(this.look, lookK)
    }

    this.keepAbove(this.camera.position, planet, 1.6)
    this.aimUpright(bird)
  }

  private aimUpright(bird: Bird): void {
    this.skyUp.copy(bird.localUp)
    this.viewDir.copy(this.smoothLook).sub(this.camera.position)
    if (this.viewDir.lengthSq() > 1e-8) {
      this.viewDir.normalize()
      const align = this.skyUp.dot(this.viewDir)
      if (Math.abs(align) > 0.96) {
        this.skyUp.addScaledVector(this.viewDir, -align)
        if (this.skyUp.lengthSq() < 1e-8) this.skyUp.copy(bird.heading)
        else this.skyUp.normalize()
      }
    }
    this.camera.up.copy(this.skyUp)
    this.camera.lookAt(this.smoothLook)
  }

  private keepAbove(pos: Vector3, planet: Planet, minAlt: number): void {
    if (planet.altitude(pos) < minAlt) planet.placeAbove(pos, minAlt, pos)
  }

  private place(bird: Bird, intoPos: Vector3, intoLook: Vector3): void {
    const lift = HEIGHT + this.groundLift * LOW_LIFT + this.highLift * HIGH_LIFT + clamp(-bird.pitch * 1.8, -1.2, 5.4)
    intoPos.copy(bird.position)
    intoPos.addScaledVector(bird.forward, -DISTANCE - this.groundLift * 1.4 - this.highLift * 2.2)
    intoPos.addScaledVector(bird.localUp, lift)
    intoPos.addScaledVector(bird.right, bird.visualRoll * 0.85)

    if (this.orbitYaw !== 0 || this.orbitPitch !== 0) {
      this.offset.copy(intoPos).sub(bird.position)
      this.offset.applyAxisAngle(bird.localUp, this.orbitYaw)
      this.offset.applyAxisAngle(bird.right, this.orbitPitch)
      intoPos.copy(bird.position).add(this.offset)
      intoLook.copy(bird.position).addScaledVector(bird.localUp, 0.4)
      return
    }

    intoLook.copy(bird.position)
    intoLook.addScaledVector(bird.forward, LOOK_AHEAD)
    intoLook.addScaledVector(bird.right, bird.visualRoll * 0.25)
    intoLook.addScaledVector(bird.localUp, bird.pitch * 3.2 + this.groundLift * 2.1 - this.highLift * 8.5)
  }
}
