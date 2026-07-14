import type { AvatarActivity, HQExecutive } from "../lib/hqTypes";

/**
 * STABLE EXECUTIVE AVATAR CONTRACT.
 *
 * Every avatar implementation (holographic V1, and future full-body
 * MetaHuman / Ready Player Me / GLB rigs) MUST accept exactly these props and
 * honor these conventions, so a richer avatar can be dropped in WITHOUT changing
 * the headquarters, offices, camera framing, or interactions:
 *
 *  - GROUND ANCHOR: `position` is the FEET anchor. The avatar's lowest point
 *    sits at local y = 0 and the figure builds UPWARD. Never center on the hips.
 *  - HUMAN SCALE: the figure is ~1.8 world units tall at scale = 1, matching a
 *    standing person. The camera rig frames offices for a person at this scale.
 *  - FACING: `rotationY` (radians) rotates the figure to face the visitor; the
 *    avatar should look "forward" along +Z in its own local space before rotation.
 *  - DATA-DRIVEN: appearance derives from `executive` (accentColor, status); motion
 *    derives from `activity`. No hardcoded per-executive geometry.
 */
export interface ExecutiveAvatarProps {
  executive: HQExecutive;
  activity: AvatarActivity;
  /** Feet/ground anchor in world space. */
  position: [number, number, number];
  /** Facing rotation in radians (Y axis). */
  rotationY?: number;
  /** Uniform scale; 1 ≈ 1.8u tall human. */
  scale?: number;
  /** Brighten/foreground the avatar when its office is focused. */
  focused?: boolean;
}

/** Nominal standing height (world units) all avatar variants target. */
export const AVATAR_HEIGHT = 1.8;

export function statusToActivity(status: HQExecutive["status"]): AvatarActivity {
  switch (status) {
    case "active":
      return "working";
    case "busy":
      return "reviewing";
    case "planning":
      return "planning";
    case "collaborating":
      return "collaborating";
    case "needs_approval":
      return "awaiting";
    case "idle":
      return "idle";
    case "offline":
      return "offline";
    default:
      return "idle";
  }
}
