/**
 * Company Playbooks Management — owner-only screen.
 *
 * Lets owners create, edit, and deactivate playbooks that the Learning Engine
 * uses to flag compliance violations on the inspection summary screen.
 *
 * Each playbook has:
 *  • A title (e.g. "Commercial Rodent Protocol")
 *  • Target pest categories / species (e.g. "rodent", "german_cockroach")
 *  • Required steps — mandatory actions that must appear in treatment notes
 *  • Chemical restrictions — products/classes that are disallowed
 *  • Optional compliance notes
 */

import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  fetchAllPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  type CompanyPlaybook,
  type NewPlaybookInput,
  type PlaybookRequiredStep,
  type ChemicalRestriction,
} from "@/lib/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slug(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ─── Empty form state ─────────────────────────────────────────────────────────

type FormState = {
  title: string;
  targetPests: string; // comma-separated
  requiredSteps: string; // one per line
  chemicalRestrictions: string; // one per line  (name | reason)
  notes: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  targetPests: "",
  requiredSteps: "",
  chemicalRestrictions: "",
  notes: "",
  isActive: true,
};

function playbookToForm(p: CompanyPlaybook): FormState {
  return {
    title: p.title,
    targetPests: p.targetPests.join(", "),
    requiredSteps: p.requiredSteps.map((s) => s.label).join("\n"),
    chemicalRestrictions: p.chemicalRestrictions
      .map((c) => (c.reason ? `${c.name} | ${c.reason}` : c.name))
      .join("\n"),
    notes: p.notes ?? "",
    isActive: p.isActive,
  };
}

function formToInput(f: FormState): NewPlaybookInput {
  const targetPests = f.targetPests
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const requiredSteps: PlaybookRequiredStep[] = f.requiredSteps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ id: slug(label), label }));

  const chemicalRestrictions: ChemicalRestriction[] = f.chemicalRestrictions
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, reason] = line.split("|").map((x) => x.trim());
      return reason ? { name, reason } : { name };
    });

  return {
    title: f.title.trim(),
    targetPests,
    requiredSteps,
    chemicalRestrictions,
    notes: f.notes.trim() || undefined,
    isActive: f.isActive,
  };
}

// ─── Playbook card ────────────────────────────────────────────────────────────

function PlaybookCard({
  playbook,
  onEdit,
  onDeactivate,
}: {
  playbook: CompanyPlaybook;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const colors = useColors();
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 15,
            }}
          >
            {playbook.title}
          </Text>
          {!playbook.isActive && (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 11,
                letterSpacing: 0.3,
              }}
            >
              INACTIVE
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity onPress={onEdit} hitSlop={8}>
            <Ionicons name="pencil-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
          {playbook.isActive && (
            <TouchableOpacity onPress={onDeactivate} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color="#F85114" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {playbook.targetPests.length > 0 && (
        <View style={{ gap: 3 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Target Pests
          </Text>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
            }}
          >
            {playbook.targetPests.join(", ")}
          </Text>
        </View>
      )}

      {playbook.requiredSteps.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Required Steps ({playbook.requiredSteps.length})
          </Text>
          {playbook.requiredSteps.map((s) => (
            <View
              key={s.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={14}
                color={colors.primary}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {playbook.chemicalRestrictions.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Restricted Chemicals ({playbook.chemicalRestrictions.length})
          </Text>
          {playbook.chemicalRestrictions.map((c, i) => (
            <View
              key={i}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}
            >
              <Ionicons
                name="ban-outline"
                size={14}
                color="#F85114"
                style={{ marginTop: 1 }}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  flex: 1,
                }}
              >
                {c.name}
                {c.reason ? (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                    }}
                  >
                    {" "}— {c.reason}
                  </Text>
                ) : null}
              </Text>
            </View>
          ))}
        </View>
      )}

      {playbook.notes ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
            fontStyle: "italic",
            lineHeight: 17,
          }}
        >
          {playbook.notes}
        </Text>
      ) : null}
    </Card>
  );
}

// ─── Edit / Create modal ──────────────────────────────────────────────────────

function PlaybookModal({
  visible,
  initial,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  initial: FormState;
  onClose: () => void;
  onSave: (f: FormState) => void;
  saving: boolean;
}) {
  const colors = useColors();
  const [form, setForm] = useState<FormState>(initial);

  useEffect(() => {
    if (visible) setForm(initial);
  }, [visible, initial]);

  const set = (key: keyof FormState) => (val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const inputStyle = {
    backgroundColor: colors.muted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.foreground,
    fontFamily: "Inter_400Regular" as const,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  };

  const labelStyle = {
    color: colors.mutedForeground,
    fontFamily: "Inter_600SemiBold" as const,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
    marginBottom: 4,
    marginTop: 12,
  };

  const hintStyle = {
    color: colors.mutedForeground,
    fontFamily: "Inter_400Regular" as const,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            gap: 12,
          }}
        >
          <TouchableOpacity onPress={onClose} disabled={saving}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text
            style={{
              flex: 1,
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 18,
            }}
          >
            {initial.title ? "Edit Playbook" : "New Playbook"}
          </Text>
          <Button
            title={saving ? "Saving…" : "Save"}
            size="md"
            disabled={saving || !form.title.trim()}
            onPress={() => onSave(form)}
          />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={labelStyle}>Playbook Title *</Text>
          <TextInput
            style={inputStyle}
            placeholder="e.g. Commercial Rodent Protocol"
            placeholderTextColor={colors.mutedForeground}
            value={form.title}
            onChangeText={set("title")}
          />

          <Text style={labelStyle}>Target Pests</Text>
          <TextInput
            style={inputStyle}
            placeholder="rodent, german_cockroach, bed_bug"
            placeholderTextColor={colors.mutedForeground}
            value={form.targetPests}
            onChangeText={set("targetPests")}
            autoCapitalize="none"
          />
          <Text style={hintStyle}>
            Comma-separated pest categories or species. The playbook is only
            enforced when these pests are found in the inspection.
          </Text>

          <Text style={labelStyle}>Required Steps</Text>
          <TextInput
            style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
            placeholder={"Apply bait stations\nDocument harborage areas\nSeal entry points"}
            placeholderTextColor={colors.mutedForeground}
            value={form.requiredSteps}
            onChangeText={set("requiredSteps")}
            multiline
            numberOfLines={4}
          />
          <Text style={hintStyle}>
            One step per line. Each step must appear in at least one finding's
            treatment note — if missing, the Learning Engine flags a warning.
          </Text>

          <Text style={labelStyle}>Chemical Restrictions</Text>
          <TextInput
            style={[inputStyle, { minHeight: 70, textAlignVertical: "top" }]}
            placeholder={"Fipronil | Not approved for food-handling areas\nAny pyrethroid"}
            placeholderTextColor={colors.mutedForeground}
            value={form.chemicalRestrictions}
            onChangeText={set("chemicalRestrictions")}
            multiline
            numberOfLines={3}
          />
          <Text style={hintStyle}>
            One per line. Optionally add a reason after a pipe (|). If a
            treatment log contains a restricted chemical, the Learning Engine
            flags an error.
          </Text>

          <Text style={labelStyle}>Notes (optional)</Text>
          <TextInput
            style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]}
            placeholder="Regulatory reference, safety notes, or link to SDS sheet…"
            placeholderTextColor={colors.mutedForeground}
            value={form.notes}
            onChangeText={set("notes")}
            multiline
            numberOfLines={3}
          />

          {/* Active toggle for edit mode */}
          {initial.title ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 20,
                padding: 14,
                backgroundColor: colors.muted,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                Playbook Active
              </Text>
              <TouchableOpacity
                onPress={() => set("isActive")(!form.isActive)}
                style={{
                  width: 44,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: form.isActive ? colors.primary : colors.border,
                  justifyContent: "center",
                  paddingHorizontal: 3,
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: "#fff",
                    alignSelf: form.isActive ? "flex-end" : "flex-start",
                  }}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PlaybooksScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useCurrentUser();
  const isOwner = user?.role === "owner";

  const [playbooks, setPlaybooks] = useState<CompanyPlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<CompanyPlaybook | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetchAllPlaybooks(token);
      setPlaybooks(res.playbooks);
    } catch (err) {
      Alert.alert("Error", "Could not load playbooks. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditTarget(null);
    setModalVisible(true);
  };

  const openEdit = (p: CompanyPlaybook) => {
    setEditTarget(p);
    setModalVisible(true);
  };

  const handleSave = async (form: FormState) => {
    setSaving(true);
    try {
      const token = await getToken();
      const input = formToInput(form);
      if (editTarget) {
        await updatePlaybook(token, editTarget.id, input);
      } else {
        await createPlaybook(token, input);
      }
      setModalVisible(false);
      await load();
    } catch (err) {
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = (p: CompanyPlaybook) => {
    Alert.alert(
      "Deactivate Playbook",
      `"${p.title}" will no longer be enforced on new inspections. You can reactivate it by editing the playbook.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await getToken();
              await deletePlaybook(token, p.id);
              await load();
            } catch {
              Alert.alert("Error", "Could not deactivate playbook.");
            }
          },
        },
      ],
    );
  };

  const active = playbooks.filter((p) => p.isActive);
  const inactive = playbooks.filter((p) => !p.isActive);

  return (
    <Screen edges={["top", "bottom"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.muted,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 22,
            }}
          >
            Company Playbooks
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
          >
            SOPs enforced by the Learning Engine
          </Text>
        </View>
        {isOwner && (
          <Pressable
            onPress={openCreate}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: colors.primary,
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="add" size={16} color={colors.primaryForeground} />
            <Text
              style={{
                color: colors.primaryForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              New
            </Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        >
          {/* Empty state */}
          {playbooks.length === 0 && (
            <View
              style={{
                alignItems: "center",
                paddingVertical: 48,
                gap: 12,
              }}
            >
              <Ionicons
                name="book-outline"
                size={40}
                color={colors.mutedForeground}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 16,
                  textAlign: "center",
                }}
              >
                No playbooks yet
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  textAlign: "center",
                  lineHeight: 19,
                  maxWidth: 280,
                }}
              >
                Create your first playbook to encode your SOPs and let the AI
                flag compliance violations automatically.
              </Text>
              {isOwner && (
                <Button title="Create Playbook" onPress={openCreate} />
              )}
            </View>
          )}

          {/* Info banner */}
          {playbooks.length > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
                backgroundColor: colors.muted,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={colors.mutedForeground}
                style={{ marginTop: 1 }}
              />
              <Text
                style={{
                  flex: 1,
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  lineHeight: 17,
                }}
              >
                The Learning Engine checks every finalised inspection against
                active playbooks. Violations appear as a warning banner on the
                inspection summary screen before the technician can push to
                dispatch.
              </Text>
            </View>
          )}

          {/* Active playbooks */}
          {active.map((p) => (
            <PlaybookCard
              key={p.id}
              playbook={p}
              onEdit={() => openEdit(p)}
              onDeactivate={() => handleDeactivate(p)}
            />
          ))}

          {/* Inactive playbooks */}
          {inactive.length > 0 && (
            <>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginTop: 8,
                  paddingHorizontal: 2,
                }}
              >
                Inactive
              </Text>
              {inactive.map((p) => (
                <PlaybookCard
                  key={p.id}
                  playbook={p}
                  onEdit={() => openEdit(p)}
                  onDeactivate={() => handleDeactivate(p)}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      <PlaybookModal
        visible={modalVisible}
        initial={editTarget ? playbookToForm(editTarget) : EMPTY_FORM}
        onClose={() => setModalVisible(false)}
        onSave={(f) => void handleSave(f)}
        saving={saving}
      />
    </Screen>
  );
}
