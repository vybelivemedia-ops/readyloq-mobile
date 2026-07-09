import { useWindowDimensions } from "react-native";

export type WindowSizeClass = "compact" | "medium" | "expanded";

/**
 * Material-style window size classes so screens adapt to phones, foldables
 * (cover vs. inner display), and tablets. Driven by useWindowDimensions, so
 * values update live on rotation and fold/unfold — never cache them.
 *
 * - compact:  width < 600  (phones, foldable cover screens)
 * - medium:   600–839      (small tablets, unfolded portrait)
 * - expanded: >= 840       (tablets landscape, unfolded landscape)
 */
export function useWindowSizeClass() {
  const { width, height } = useWindowDimensions();
  const sizeClass: WindowSizeClass =
    width >= 840 ? "expanded" : width >= 600 ? "medium" : "compact";
  return {
    width,
    height,
    isLandscape: width > height,
    sizeClass,
    isCompact: sizeClass === "compact",
    isExpanded: sizeClass === "expanded",
  };
}
