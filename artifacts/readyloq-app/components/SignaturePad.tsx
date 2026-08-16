/**
 * SignaturePad — captures a freehand signature using React Native's
 * PanResponder and renders strokes with react-native-svg.
 *
 * The finished signature is serialized as a full <svg> string ready for
 * storage and display anywhere (data URL, inline, portal img tag).
 */
import React, { useCallback, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { Path, Svg } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

type Point = { x: number; y: number };

function pointsToSvgD(pts: Point[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${(pts[0].x + 0.1).toFixed(1)} ${pts[0].y.toFixed(1)}`;
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
    const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

export function strokesToSvgString(
  strokes: Point[][],
  width: number,
  height: number,
): string {
  const paths = strokes
    .filter((s) => s.length > 0)
    .map((pts) => {
      const d = pointsToSvgD(pts);
      return `<path d="${d}" stroke="#1a1a2e" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/>${paths}</svg>`;
}

type Props = {
  width: number;
  height: number;
  /** Called each time a stroke completes — passes the current SVG string. */
  onChange: (svg: string, isEmpty: boolean) => void;
  onClear: () => void;
  strokeColor?: string;
};

export function SignaturePad({ width, height, onChange, onClear, strokeColor = "#1a1a2e" }: Props) {
  const colors = useColors();
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const currentStroke = useRef<Point[]>([]);
  // Stable ref so PanResponder closure doesn't go stale.
  const strokesRef = useRef<Point[][]>([]);

  const commit = useCallback(
    (nextStrokes: Point[][]) => {
      strokesRef.current = nextStrokes;
      const isEmpty = nextStrokes.every((s) => s.length === 0);
      onChange(strokesToSvgString(nextStrokes, width, height), isEmpty);
    },
    [onChange, width, height],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentStroke.current = [{ x: locationX, y: locationY }];
        const next = [...strokesRef.current, currentStroke.current];
        setStrokes(next);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentStroke.current.push({ x: locationX, y: locationY });
        const next = [
          ...strokesRef.current.slice(0, -1),
          [...currentStroke.current],
        ];
        setStrokes(next);
        strokesRef.current = next;
      },
      onPanResponderRelease: () => {
        const next = strokesRef.current;
        commit(next);
        currentStroke.current = [];
      },
    }),
  ).current;

  const handleClear = () => {
    setStrokes([]);
    strokesRef.current = [];
    currentStroke.current = [];
    onClear();
  };

  return (
    <View>
      <View
        style={{
          width,
          height,
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: "#fff",
          overflow: "hidden",
        }}
        {...panResponder.panHandlers}
      >
        <Svg width={width} height={height}>
          {strokes.map((pts, si) => {
            const d = pointsToSvgD(pts);
            if (!d) return null;
            return (
              <Path
                key={si}
                d={d}
                stroke={strokeColor}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </Svg>
        {strokes.length === 0 && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Text
              style={{
                color: "#bbb",
                fontFamily: "Inter_400Regular",
                fontSize: 14,
              }}
            >
              Sign here
            </Text>
          </View>
        )}
      </View>

      {strokes.length > 0 && (
        <Pressable
          onPress={handleClear}
          style={{ alignSelf: "flex-end", paddingTop: 6, paddingRight: 2 }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
            }}
          >
            Clear
          </Text>
        </Pressable>
      )}
    </View>
  );
}
