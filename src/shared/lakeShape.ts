import type { LakeCenter, Vec3Like } from './types';
import { cross, dot, normalize, v3 } from './math';

/**
 * Deterministic, non-circular shoreline shape shared by simulation water,
 * terrain tint and the rendered lake mesh, so the visible shore matches the
 * wet/dry boundary. The shape is derived from the lake normal only, so it is
 * stable across reloads without extra save state.
 */

const AMP = 0.22;

function phaseOf(n: Vec3Like): number {
  const s = Math.sin(n.x * 12.9898 + n.y * 78.233 + n.z * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}

/** Shoreline radius multiplier at azimuth `theta` (radians) around the lake. */
export function lakeShoreFactorByAngle(lake: LakeCenter, theta: number): number {
  const p = phaseOf(lake.normal);
  const m =
    0.55 * Math.sin(3 * theta + p) +
    0.3 * Math.sin(5 * theta + p * 1.7) +
    0.15 * Math.sin(7 * theta + p * 2.1);
  return 1 + AMP * m;
}

function tangentBasis(n: Vec3Like): { t1: Vec3Like; t2: Vec3Like } {
  const ref = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const t1 = normalize(v3(), cross(v3(), n, ref));
  const t2 = normalize(v3(), cross(v3(), n, t1));
  return { t1, t2 };
}

/** Azimuth of `dir` around the lake normal, in the lake's tangent plane. */
export function lakeAzimuth(lake: LakeCenter, dir: Vec3Like): number {
  const { t1, t2 } = tangentBasis(lake.normal);
  const n = lake.normal;
  const d = dot(dir, n);
  const p = v3(dir.x - n.x * d, dir.y - n.y * d, dir.z - n.z * d);
  return Math.atan2(dot(p, t2), dot(p, t1));
}

/** Effective angular shoreline radius of the lake toward `dir`. */
export function lakeShoreRadius(lake: LakeCenter, dir: Vec3Like): number {
  return lake.radius * lakeShoreFactorByAngle(lake, lakeAzimuth(lake, dir));
}

/** Direction on the sphere at azimuth `theta` and `angularDistance` from the center. */
export function lakeBoundaryDirection(
  lake: LakeCenter,
  theta: number,
  angularDistance: number,
  out: Vec3Like = v3(),
): Vec3Like {
  const { t1, t2 } = tangentBasis(lake.normal);
  const n = lake.normal;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const tx = t1.x * ct + t2.x * st;
  const ty = t1.y * ct + t2.y * st;
  const tz = t1.z * ct + t2.z * st;
  const ca = Math.cos(angularDistance);
  const sa = Math.sin(angularDistance);
  out.x = n.x * ca + tx * sa;
  out.y = n.y * ca + ty * sa;
  out.z = n.z * ca + tz * sa;
  return normalize(out, out);
}
