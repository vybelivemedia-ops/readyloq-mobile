import type { PropertyLocation, SpaceSnapshot } from "@workspace/db";

export const COMMON_AREA_TYPES = ["basement", "lobby", "hallway", "stairwell", "mechanical_room", "trash_room", "exterior", "other"] as const;
export const MAX_PROPERTY_LOCATIONS = 2048;
export class FoundationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function activeLocation(node: PropertyLocation, nodes: PropertyLocation[]): boolean {
  const visited = new Set<string>();
  let current: PropertyLocation | undefined = node;
  while (current) {
    if (current.archivedAt || visited.has(current.id)) return false;
    visited.add(current.id);
    if (!current.parentId) return true;
    current = nodes.find((n) => n.id === current!.parentId);
  }
  return false;
}
export function validateLocation(node: Pick<PropertyLocation, "kind" | "parentId" | "commonAreaType">, nodes: PropertyLocation[]): void {
  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  if (node.parentId && (!parent || !activeLocation(parent, nodes))) throw new FoundationError(400, "Parent must be active and belong to this property");
  const valid = node.kind === "building" ? !parent :
    node.kind === "floor" ? parent?.kind === "building" :
    node.kind === "unit" ? parent?.kind === "building" || parent?.kind === "floor" :
    !parent || parent.kind === "building" || parent.kind === "floor";
  if (!valid) throw new FoundationError(400, "Invalid hierarchy: buildings contain floors/units; common areas may belong to property, building or floor");
  if (node.kind === "common_area" ? !COMMON_AREA_TYPES.includes(node.commonAreaType as typeof COMMON_AREA_TYPES[number]) : node.commonAreaType != null)
    throw new FoundationError(400, "Specify a supported common-area type only for common areas");
}
export function snapshotSpace(node: PropertyLocation, nodes: PropertyLocation[]): SpaceSnapshot {
  if (node.kind !== "unit" && node.kind !== "common_area") throw new FoundationError(400, "Only units and common areas have coverage");
  const ancestors: SpaceSnapshot["ancestors"] = [];
  let parent = nodes.find((n) => n.id === node.parentId);
  while (parent) {
    ancestors.unshift({ id: parent.id, label: parent.label, kind: parent.kind });
    parent = nodes.find((n) => n.id === parent!.parentId);
  }
  return { label: node.label, kind: node.kind, commonAreaType: node.commonAreaType, ancestors };
}
