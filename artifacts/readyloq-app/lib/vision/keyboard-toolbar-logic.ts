/**
 * Pure utility functions and shared style constants for the Save/Copy toolbar
 * keyboard-avoidance behaviour in the full-screen photo viewer
 * (InspectionDetail.tsx, #110 / #468).
 *
 * WHY a separate module?
 *   React Native's KeyboardAvoidingView hides its adjustment logic inside the
 *   framework.  Extracting the platform selection and the critical geometry
 *   into this module lets unit tests catch regressions — if the component
 *   imports and uses these exports, removing or changing them breaks the tests.
 *
 * The component wires these up as:
 *
 *   import {
 *     getKeyboardAvoidingBehavior,
 *     VIEWER_TOOLBAR_PADDING_TOP,
 *     VIEWER_TOOLBAR_PADDING_BOTTOM,
 *     VIEWER_TOOLBAR_BUTTON_PADDING_V,
 *   } from "@/lib/vision/keyboard-toolbar-logic";
 *
 *   <KeyboardAvoidingView behavior={getKeyboardAvoidingBehavior(Platform.OS)}>
 *     <View style={{ paddingVertical: VIEWER_TOOLBAR_PADDING_TOP,
 *                    paddingBottom:   VIEWER_TOOLBAR_PADDING_BOTTOM }}>
 *       <TouchableOpacity style={{ paddingVertical: VIEWER_TOOLBAR_BUTTON_PADDING_V }}>
 *         ...
 *       </TouchableOpacity>
 *     </View>
 *   </KeyboardAvoidingView>
 */

// ─── Shared style constants ────────────────────────────────────────────────────
// These are the single source of truth for the toolbar's vertical layout.
// Both InspectionDetail.tsx and the test suite reference them directly, so a
// mismatch between the rendered layout and the test geometry is impossible.

/** Top padding of the Save/Copy toolbar row (px). */
export const VIEWER_TOOLBAR_PADDING_TOP = 14;

/**
 * Bottom padding of the Save/Copy toolbar row (px).
 * The larger value accounts for home-bar / gesture-navigation insets on modern
 * Android and iOS devices.
 */
export const VIEWER_TOOLBAR_PADDING_BOTTOM = 32;

/** Vertical padding inside each button (applied top AND bottom, px). */
export const VIEWER_TOOLBAR_BUTTON_PADDING_V = 12;

/**
 * Approximate button content height: icon (16 px) or text line-height (~18 px).
 * We take the larger of the two so the height constant stays conservative.
 */
export const VIEWER_TOOLBAR_BUTTON_CONTENT_H = 18;

/**
 * Total nominal height of the Save/Copy toolbar row (px), derived from the
 * constants above so it stays in sync with the rendered layout.
 *
 *   paddingTop
 *   + button (paddingV + content + paddingV)
 *   + paddingBottom
 */
export const VIEWER_TOOLBAR_HEIGHT =
  VIEWER_TOOLBAR_PADDING_TOP +
  VIEWER_TOOLBAR_BUTTON_PADDING_V +
  VIEWER_TOOLBAR_BUTTON_CONTENT_H +
  VIEWER_TOOLBAR_BUTTON_PADDING_V +
  VIEWER_TOOLBAR_PADDING_BOTTOM;

// ─── Platform behavior selection ───────────────────────────────────────────────

/**
 * Returns the correct `behavior` prop for `KeyboardAvoidingView` on the given
 * platform OS string (mirrors `Platform.OS`).
 *
 * Android needs "padding" because its window-resize model pushes the layout
 * bottom up; iOS needs "position" because UIKit resizes the window rather than
 * the view, so a translation is required instead.
 *
 * This is the single authoritative place this decision is made.  Importing and
 * calling it in InspectionDetail.tsx means any future change here is
 * automatically caught by tests.
 */
export function getKeyboardAvoidingBehavior(
  os: string,
): "padding" | "position" {
  return os === "android" ? "padding" : "position";
}

// ─── Geometry helpers (used only by tests) ────────────────────────────────────

/**
 * Returns the Y-coordinate of the toolbar's **top** edge after the
 * KeyboardAvoidingView has moved it above the soft keyboard.
 *
 * @param screenHeight   Total device screen height in logical pixels.
 * @param toolbarHeight  Height of the Save/Copy toolbar row in logical pixels.
 * @param keyboardHeight Height of the visible soft keyboard (0 = hidden).
 */
export function toolbarTopAfterKeyboard(
  screenHeight: number,
  toolbarHeight: number,
  keyboardHeight: number,
): number {
  return screenHeight - keyboardHeight - toolbarHeight;
}

/**
 * Returns `true` when the entire Save/Copy toolbar is within the visible area
 * of the screen (above the keyboard, not clipped at the top).
 */
export function isToolbarFullyVisible(
  screenHeight: number,
  toolbarHeight: number,
  keyboardHeight: number,
): boolean {
  const topY = toolbarTopAfterKeyboard(screenHeight, toolbarHeight, keyboardHeight);
  const bottomY = topY + toolbarHeight;
  return topY >= 0 && bottomY <= screenHeight - keyboardHeight;
}

/**
 * Returns how many pixels of clearance sit between the toolbar's bottom edge
 * and the keyboard's top edge.  Must be ≥ 0; negative means overlap (a bug).
 */
export function toolbarClearance(
  screenHeight: number,
  toolbarHeight: number,
  keyboardHeight: number,
): number {
  const bottomY = toolbarTopAfterKeyboard(screenHeight, toolbarHeight, keyboardHeight) + toolbarHeight;
  const keyboardTopY = screenHeight - keyboardHeight;
  return keyboardTopY - bottomY;
}
