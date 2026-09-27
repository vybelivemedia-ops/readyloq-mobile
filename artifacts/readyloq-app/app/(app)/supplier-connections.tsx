/**
 * Supplier import screen (owner-only).
 *
 * Lets owners paste or load a CSV export from their distributor's portal
 * (Veseris, Target Specialty, Univar, or other) and import delivery lines
 * directly into the right technician's inventory.
 *
 * The server matches rows to products by EPA registration number or name,
 * verifies technician IDs belong to this company, skips duplicate order refs
 * (idempotent re-imports are safe), and returns a summary of what was
 * imported, skipped, or unmatched.
 *
 * No API credentials are stored — order data flows through CSV export, not
 * a supplier API. API-based integration will be a separate future capability.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { importSupplierCsv, type ImportRow, type ImportResult } from "@/lib/api-client/inventory";

const EXAMPLE_CSV = `technician_id,epa_number,quantity,unit,order_ref,date
user_abc123,34704-910,32,oz,VS-2026-001,2026-08-21
user_def456,432-1399,2,lb,VS-2026-001,2026-08-21`;

const COL_ALIASES: Record<string, keyof ImportRow> = {
  technician_id: "technicianId",
  tech_id:       "technicianId",
  epa_number:    "productEpa",
  epa:           "productEpa",
  product_epa:   "productEpa",
  product_name:  "productName",
  name:          "productName",
  quantity:      "quantity",
  qty:           "quantity",
  unit:          "unit",
  order_ref:     "orderRef",
  order_number:  "orderRef",
  ref:           "orderRef",
  date:          "date",
};

function parseCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must have a header row and at least one data row."] };
  }

  const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const rows: ImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",").map((c) => c.trim());
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx] ?? ""; });

    const row: Partial<ImportRow> = {};
    for (const [col, field] of Object.entries(COL_ALIASES)) {
      if (raw[col] !== undefined && raw[col] !== "") {
        if (field === "quantity") {
          const n = parseFloat(raw[col]!);
          if (!Number.isNaN(n)) row.quantity = n;
        } else {
          (row as Record<string, unknown>)[field] = raw[col];
        }
      }
    }

    if (!row.technicianId) { errors.push(`Row ${i}: missing technician_id`); continue; }
    if (!row.productEpa && !row.productName) { errors.push(`Row ${i}: needs epa_number or product_name`); continue; }
    if (!row.quantity || row.quantity <= 0) { errors.push(`Row ${i}: invalid quantity`); continue; }
    if (!row.orderRef) { errors.push(`Row ${i}: missing order_ref`); continue; }
    row.unit = row.unit ?? "unit";

    rows.push(row as ImportRow);
  }

  return { rows, errors };
}

export default function SupplierConnectionsScreen() {
  const colors = useColors();
  const router = useRouter();

  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handlePreview = () => {
    const { rows, errors } = parseCsv(csvText);
    setParseErrors(errors);
    setPreview(rows.length > 0 ? rows : null);
    setResult(null);
  };

  const handleImport = async () => {
    if (!preview || preview.length === 0) return;
    setImporting(true);
    try {
      const res = await importSupplierCsv({ rows: preview });
      setResult(res);
      setPreview(null);
      setCsvText("");
    } catch {
      Alert.alert("Import failed", "Could not reach the server. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            Import Supplier Order
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            Paste a CSV export from Veseris, Target Specialty, or Univar
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        {/* Info banner */}
        <View style={{
          padding: 12,
          borderRadius: 10,
          backgroundColor: colors.primary + "0E",
          borderWidth: 1,
          borderColor: colors.primary + "30",
          flexDirection: "row",
          gap: 10,
        }}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primary} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 }}>
            Export a delivery CSV from your supplier portal and paste it below. ReadyLoq matches rows by EPA registration number or product name, then adds each delivery to the right technician's on-hand inventory. Re-importing the same order is safe — duplicate rows are automatically skipped.
          </Text>
        </View>

        {/* CSV format guide */}
        <Card style={{ padding: 12, gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
            Expected CSV format
          </Text>
          <View style={{ backgroundColor: colors.muted, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 18 }}>
              {EXAMPLE_CSV}
            </Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17 }}>
            Columns: technician_id (Clerk user ID), epa_number or product_name, quantity, unit, order_ref, date (YYYY-MM-DD)
          </Text>
        </Card>

        {/* Import result */}
        {result && (
          <Card style={{ padding: 14, gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Import complete
            </Text>
            <View style={{ flexDirection: "row", gap: 16 }}>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: "#22c55e", fontFamily: "Inter_700Bold", fontSize: 20 }}>{result.imported}</Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>imported</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: "#f59e0b", fontFamily: "Inter_700Bold", fontSize: 20 }}>{result.skipped}</Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>skipped (dup)</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: result.unmatched.length > 0 ? "#ef4444" : colors.mutedForeground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
                  {result.unmatched.length}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>unmatched</Text>
              </View>
            </View>
            {result.unmatched.length > 0 && (
              <View style={{ gap: 4, marginTop: 4 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                  Unmatched rows:
                </Text>
                {result.unmatched.slice(0, 5).map((u, i) => (
                  <Text key={i} style={{ color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 11 }}>
                    Row {u.rowIndex + 1}: {u.reason}
                  </Text>
                ))}
                {result.unmatched.length > 5 && (
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                    …and {result.unmatched.length - 5} more
                  </Text>
                )}
              </View>
            )}
          </Card>
        )}

        {/* CSV paste area */}
        {!preview && !result && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
              Paste CSV
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              placeholder={`technician_id,epa_number,quantity,unit,order_ref,date\n…`}
              placeholderTextColor={colors.mutedForeground}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                minHeight: 160,
                color: colors.foreground,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                textAlignVertical: "top",
              }}
            />
            {parseErrors.length > 0 && (
              <View style={{ gap: 3 }}>
                {parseErrors.map((e, i) => (
                  <Text key={i} style={{ color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 12 }}>{e}</Text>
                ))}
              </View>
            )}
            <Pressable
              onPress={handlePreview}
              disabled={!csvText.trim()}
              style={({ pressed }) => ({
                paddingVertical: 13,
                borderRadius: 12,
                alignItems: "center",
                backgroundColor: !csvText.trim() ? colors.primary + "55" : colors.primary,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
                Preview import
              </Text>
            </Pressable>
          </View>
        )}

        {/* Preview table */}
        {preview && (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Preview — {preview.length} row{preview.length !== 1 ? "s" : ""}
            </Text>
            {preview.slice(0, 20).map((row, i) => (
              <Card key={i} style={{ padding: 12, gap: 3 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                  {row.productName ?? row.productEpa ?? `Product #${row.productId}`}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {row.quantity} {row.unit} → tech {(row.technicianId ?? "").substring(0, 14)}…
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                  Ref: {row.orderRef}{row.date ? ` · ${row.date}` : ""}
                </Text>
              </Card>
            ))}
            {preview.length > 20 && (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center" }}>
                …and {preview.length - 20} more rows
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => { setPreview(null); setParseErrors([]); }}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: colors.muted,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                  Back
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { void handleImport(); }}
                disabled={importing}
                style={({ pressed }) => ({
                  flex: 2,
                  paddingVertical: 13,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: colors.primary,
                  opacity: pressed || importing ? 0.7 : 1,
                })}
              >
                {importing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
                    Import {preview.length} row{preview.length !== 1 ? "s" : ""}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
