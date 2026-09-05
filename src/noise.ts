/** Hash-based value noise with cosine interpolation. Deterministic for a given seed. */
export class Noise2D {
  private perm = new Uint8Array(512)

  constructor(seed = 1) {
    const source = new Uint8Array(256)
    for (let i = 0; i < 256; i++) source[i] = i

    let s = seed >>> 0
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0
      const j = s % (i + 1)
      const tmp = source[i]
      source[i] = source[j]
      source[j] = tmp
    }

    for (let i = 0; i < 512; i++) this.perm[i] = source[i & 255]
  }

  /** Smooth value in roughly [-1, 1]. */
  value(x: number, z: number): number {
    const x0 = Math.floor(x)
    const z0 = Math.floor(z)
    const tx = fade(x - x0)
    const tz = fade(z - z0)

    const n00 = this.grad(x0, z0)
    const n10 = this.grad(x0 + 1, z0)
    const n01 = this.grad(x0, z0 + 1)
    const n11 = this.grad(x0 + 1, z0 + 1)

    const nx0 = n00 + (n10 - n00) * tx
    const nx1 = n01 + (n11 - n01) * tx
    return nx0 + (nx1 - nx0) * tz
  }

  fbm(x: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += this.value(x * freq, z * freq) * amp
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }

  ridge(x: number, z: number, octaves: number): number {
    return 1 - Math.abs(this.fbm(x, z, octaves, 2.05, 0.52))
  }

  private grad(ix: number, iz: number): number {
    const h = this.perm[(ix + this.perm[iz & 255]) & 255]
    const gx = (h & 1 ? 1 : -1) * ((h >> 2) / 64 + 0.25)
    const gz = (h & 2 ? 1 : -1) * (((h >> 3) & 7) / 8 + 0.15)
    return gx + gz
  }
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}
