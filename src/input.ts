export type FlightInput = {
  throttle: number
  yaw: number
  pitch: number
  flap: boolean
  glide: boolean
  brake: boolean
  tuck: boolean
  mouseYaw: number
  mousePitch: number
  freeLook: boolean
}

export class Input {
  readonly keys = new Set<string>()
  locked = false
  private mouseDX = 0
  private mouseDY = 0
  private flapQueued = false
  private spaceHeld = false
  private rmb = false

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    target.addEventListener('click', this.onClick)
    target.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
  }

  detach(target: HTMLElement): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    target.removeEventListener('click', this.onClick)
    target.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
  }

  sample(): FlightInput {
    const up = this.held('KeyW', 'ArrowUp')
    const down = this.held('KeyS', 'ArrowDown')
    const left = this.held('KeyA', 'ArrowLeft')
    const right = this.held('KeyD', 'ArrowRight')
    const tuck = this.held('ShiftLeft', 'ShiftRight')
    const brake = this.held('ControlLeft', 'ControlRight')
    const flap = this.flapQueued
    this.flapQueued = false

    const mouseYaw = this.mouseDX
    const mousePitch = this.mouseDY
    this.mouseDX = 0
    this.mouseDY = 0

    return {
      throttle: up ? 1 : 0,
      yaw: (left ? 1 : 0) - (right ? 1 : 0),
      pitch: down ? 1 : 0,
      flap,
      glide: this.spaceHeld,
      brake,
      tuck,
      mouseYaw,
      mousePitch,
      freeLook: this.rmb,
    }
  }

  private held(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code))
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat && !this.spaceHeld) {
        this.spaceHeld = true
        this.flapQueued = true
      }
      this.keys.add(event.code)
      return
    }
    this.keys.add(event.code)
    if (
      event.code.startsWith('Arrow') ||
      event.code === 'KeyW' ||
      event.code === 'KeyA' ||
      event.code === 'KeyS' ||
      event.code === 'KeyD'
    ) {
      event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.spaceHeld = false
    this.keys.delete(event.code)
  }

  private onBlur = (): void => {
    this.keys.clear()
    this.spaceHeld = false
    this.flapQueued = false
    this.rmb = false
  }

  private onClick = (): void => {
    if (!this.locked) {
      void document.body.requestPointerLock()
    }
  }

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === document.body
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (event.button === 2) this.rmb = true
  }

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.rmb = false
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked && !this.rmb) return
    this.mouseDX += event.movementX
    this.mouseDY += event.movementY
  }
}
