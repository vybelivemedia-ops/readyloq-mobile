import { HolographicAvatar } from "./HolographicAvatar";
import type { ExecutiveAvatarProps } from "./avatarTypes";

/**
 * Swap point for executive avatars. To upgrade the whole headquarters to
 * full-body avatars later, implement a new component against
 * ExecutiveAvatarProps (e.g. a GLB/Ready Player Me/MetaHuman renderer) and set
 * AVATAR_VARIANT to it. Nothing else in the HQ, offices, camera, or HUD changes.
 */
export type AvatarVariant = "holographic";

export const AVATAR_VARIANT: AvatarVariant = "holographic";

export function AvatarRenderer(props: ExecutiveAvatarProps) {
  switch (AVATAR_VARIANT) {
    case "holographic":
    default:
      return <HolographicAvatar {...props} />;
  }
}
