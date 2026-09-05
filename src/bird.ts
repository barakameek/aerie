import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
} from 'three'
import type { FlightInput } from './input.ts'
import { clamp, damp, lerp, smoothstep, wrapAngle } from './math.ts'
import { treeHitRadius, treeHitTop, type Forest, type TreeCollider } from './forest.ts'
import { SEA_LEVEL, type Planet } from './planet.ts'

const Z_AXIS = new Vector3(0, 0, 1)

const MIN_SPEED = 6
const CRUISE_MAX = 45
export const SPRINT_CAP_MIN = 45
export const SPRINT_CAP_MAX = 100
export const SPRINT_CAP_DEFAULT = 60