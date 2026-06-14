import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export type ReportMode = "customer" | "internal";

const TEAL = "#0ea5e9";
const DARK = "#0f172a";
const NAVY = "#1e293b";
const GRAY_700 = "#374151";
const GRAY_500 = "#6b7280";
const GRAY_200 = "#e5e7eb";
const GRAY_100 = "#f3f4f6";
const WHITE = "#ffffff";
const AMBER = "#f59e0b";
const AMBER_BG = "#fef3c7";

const DEFAULT_LOGO = `${window.location.origin}${import.meta.env.BASE_URL}logo.png`;

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#64748b",
};

const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: WHITE,
    paddingTop: 44,
    paddingBottom: 44,
    paddingLeft: 44,
    paddingRight: 44,
    fontSize: 9,
    color: DARK,
    lineHeight: 1.5,
  },
  coverPage: {
    fontFamily: "Helvetica",
    backgroundColor: DARK,
    padding: 0,
    color: WHITE,
  },
  coverTopBar: { height: 10, backgroundColor: TEAL },
  coverBody: { padding: 52, flex: 1 },
  coverLogoBox: { marginBottom: 40 },
  coverLogo: { width: 44, height: 44 },
  coverCompany: { fontSize: 22, fontFamily: "Helvetica-Bold", color: WHITE, marginBottom: 4 },
  coverTagline: { fontSize: 9, color: "#94a3b8" },
  coverDivider: { height: 1, backgroundColor: TEAL, marginVertical: 28 },
  coverReportTitle: { fontSize: 17, fontFamily: "Helvetica-Bold", color: WHITE, marginBottom: 6 },
  coverReportSub: { fontSize: 9, color: "#94a3b8", marginBottom: 36 },
  coverModeChip: {
    alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 10,
    borderRadius: 12, marginBottom: 28,
  },
  coverModeText: { fontSize: 7, fontFamily: "Helvetica-Bold" },
  coverMetaRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  coverMetaLabel: { width: 100, fontSize: 8, color: "#94a3b8", fontFamily: "Helvetica-Bold" },
  coverMetaValue: { flex: 1, fontSize: 9, color: WHITE },
  coverFooter: {
    position: "absolute", bottom: 32, left: 52, right: 52,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  coverFooterText: { fontSize: 7, color: "#475569" },

  secHeader: { backgroundColor: TEAL, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 3, marginBottom: 18 },
  secHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  secHeaderText: { fontSize: 11, fontFamily: "Helvetica-Bold", color: WHITE },
  secHeaderSub: { fontSize: 7, color: "rgba(255,255,255,0.75)" },

  internalBadge: {
    alignSelf: "flex-start", backgroundColor: AMBER_BG,
    borderWidth: 1, borderColor: AMBER,
    borderRadius: 3, paddingVertical: 3, paddingHorizontal: 8, marginBottom: 14,
  },
  internalBadgeText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#92400e" },

  riskBadge: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 18, borderRadius: 4, marginBottom: 20 },
  riskText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE },
  metricsRow: { flexDirection: "row", marginBottom: 24 },
  metricCard: { flex: 1, borderRadius: 4, padding: 12, marginRight: 8, backgroundColor: GRAY_100 },
  metricCardLast: { flex: 1, borderRadius: 4, padding: 12, backgroundColor: GRAY_100 },
  metricValue: { fontSize: 20, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2 },
  metricLabel: { fontSize: 7, color: GRAY_500 },
  bodyText: { fontSize: 9, color: GRAY_700, lineHeight: 1.6 },
  divider: { height: 1, backgroundColor: GRAY_200, marginVertical: 10 },
  label: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GRAY_500, marginBottom: 3 },

  findingCard: {
    flexDirection: "row", marginBottom: 10, borderRadius: 4,
    borderWidth: 1, borderColor: GRAY_200,
  },
  findingSevBar: { width: 4, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  findingBody: { flex: 1, padding: 10 },
  findingTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  findingMeta: { flexDirection: "row", marginBottom: 4 },
  findingMetaText: { fontSize: 7, color: GRAY_500, marginRight: 12 },
  findingDesc: { fontSize: 8, color: GRAY_700, lineHeight: 1.5 },
  findingConf: { fontSize: 7, color: TEAL, marginTop: 4 },

  photoGrid: { flexDirection: "row", flexWrap: "wrap" },
  photoCell: { width: "48%", marginBottom: 12, marginRight: "2%" },
  photoImg: { width: "100%", height: 148, borderRadius: 3 },
  photoCaption: { fontSize: 7, color: GRAY_500, marginTop: 3 },
  photoMeta: { fontSize: 6, color: "#9ca3af", marginTop: 1 },

  recItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  recBullet: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: TEAL,
    alignItems: "center", justifyContent: "center",
    marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  recBulletText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: WHITE },
  recText: { flex: 1, fontSize: 9, color: GRAY_700, lineHeight: 1.5 },

  obsBox: { backgroundColor: GRAY_100, borderRadius: 4, padding: 14, marginBottom: 12 },
  obsBoxLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 5 },
  obsBoxText: { fontSize: 9, color: GRAY_700, lineHeight: 1.7 },

  hotspotRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: GRAY_200 },
  hotspotDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8, marginTop: 2, flexShrink: 0 },
  hotspotZone: { fontSize: 8, fontFamily: "Helvetica-Bold", width: 110 },
  hotspotSev: { width: 48, fontSize: 7, color: GRAY_500 },
  hotspotDesc: { flex: 1, fontSize: 8, color: GRAY_700 },

  tableHeader: { flexDirection: "row", backgroundColor: TEAL, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3, marginBottom: 2 },
  tableHeaderText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: GRAY_200 },
  tableCell: { fontSize: 8, color: GRAY_700 },

  sigBlock: { flex: 1, marginRight: 32 },
  sigSpacer: { height: 48 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: GRAY_200, marginBottom: 6 },
  sigName: { fontSize: 8, color: GRAY_700 },
  sigRole: { fontSize: 7, color: GRAY_500, marginTop: 2 },

  pageFooter: {
    position: "absolute", bottom: 22, left: 44, right: 44,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderTopWidth: 1, borderTopColor: GRAY_200, paddingTop: 6,
  },
  pageFooterText: { fontSize: 7, color: GRAY_500 },
});

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
function riskColor(sev: string | null | undefined) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return "#ef4444";
  if (s === "high") return "#f97316";
  if (s === "medium") return "#f59e0b";
  return "#10b981";
}
function sevColor(s: string | null | undefined) {
  return SEV_COLOR[(s ?? "low").toLowerCase()] ?? SEV_COLOR.low;
}

function PageFooter({ company, reportNum }: { company: string; reportNum: string }) {
  return (
    <View style={S.pageFooter} fixed>
      <Text style={S.pageFooterText}>{company} — Confidential Inspection Report</Text>
      <Text style={S.pageFooterText}>{reportNum}</Text>
    </View>
  );
}

function SectionHeader({ title, sub, internal }: { title: string; sub?: string; internal?: boolean }) {
  return (
    <View style={S.secHeader}>
      <View style={S.secHeaderRow}>
        <Text style={S.secHeaderText}>{title}</Text>
        {internal && <Text style={S.secHeaderSub}>INTERNAL USE ONLY</Text>}
      </View>
      {sub && !internal && <Text style={S.secHeaderSub}>{sub}</Text>}
    </View>
  );
}

function CoverPage({ report, branding, dateStr, reportNum, mode }: any) {
  const rc = riskColor(report.severity);
  const isInternal = mode === "internal";
  return (
    <Page size="LETTER" style={S.coverPage}>
      <View style={S.coverTopBar} />
      <View style={S.coverBody}>
        <View style={S.coverLogoBox}>
          <Image src={branding.logoUrl || DEFAULT_LOGO} style={S.coverLogo} />
          <Text style={S.coverCompany}>{branding.companyName ?? "ReadyLoq"}</Text>
          {branding.tagline ? <Text style={S.coverTagline}>{branding.tagline}</Text> : null}
        </View>

        <View style={S.coverDivider} />

        <Text style={S.coverReportTitle}>Pest Control Inspection Report</Text>
        <Text style={S.coverReportSub}>{report.title}</Text>

        <View style={[S.coverModeChip, { backgroundColor: isInternal ? AMBER_BG : "#dcfce7", borderWidth: 1, borderColor: isInternal ? AMBER : "#22c55e" }]}>
          <Text style={[S.coverModeText, { color: isInternal ? "#92400e" : "#166534" }]}>
            {isInternal ? "INTERNAL REPORT" : "CUSTOMER REPORT"}
          </Text>
        </View>

        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>REPORT NUMBER</Text>
          <Text style={S.coverMetaValue}>{reportNum}</Text>
        </View>
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>PROPERTY</Text>
          <Text style={S.coverMetaValue}>{report.siteAddress}</Text>
        </View>
        {report.clientName ? (
          <View style={S.coverMetaRow}>
            <Text style={S.coverMetaLabel}>CLIENT</Text>
            <Text style={S.coverMetaValue}>{report.clientName}</Text>
          </View>
        ) : null}
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>INSPECTION DATE</Text>
          <Text style={S.coverMetaValue}>{dateStr}</Text>
        </View>
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>TECHNICIAN</Text>
          <Text style={S.coverMetaValue}>{report.technicianName}</Text>
        </View>
        <View style={S.coverMetaRow}>
          <Text style={S.coverMetaLabel}>RISK LEVEL</Text>
          <Text style={[S.coverMetaValue, { color: rc, fontFamily: "Helvetica-Bold" }]}>
            {(report.severity ?? "N/A").toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={S.coverFooter}>
        <Text style={S.coverFooterText}>
          {branding.supportEmail ?? ""}{branding.supportPhone ? "  ·  " + branding.supportPhone : ""}
        </Text>
        <Text style={S.coverFooterText}>Generated {new Date().toLocaleDateString()}</Text>
      </View>
    </Page>
  );
}

function ExecutiveSummaryPage({ report, findings, recommendations, inspection, branding }: any) {
  const rc = riskColor(report.severity);
  const followUp = findings.some((f: any) => (f.severity ?? "") === "critical" || (f.severity ?? "") === "high");
  const areas = [...new Set((findings as any[]).map((f: any) => f.location).filter(Boolean))];
  const company = branding.companyName ?? "ReadyLoq";
  const reportNum = `RPT-${String(report.id).padStart(4, "0")}`;
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Executive Summary" sub={report.siteAddress} />

      <View style={[S.riskBadge, { backgroundColor: rc }]}>
        <Text style={S.riskText}>
          {(report.severity ?? "N/A").toUpperCase()} RISK
        </Text>
      </View>

      <View style={S.metricsRow}>
        <View style={S.metricCard}>
          <Text style={S.metricValue}>{findings.length}</Text>
          <Text style={S.metricLabel}>Total Findings</Text>
        </View>
        <View style={S.metricCard}>
          <Text style={S.metricValue}>{recommendations.length}</Text>
          <Text style={S.metricLabel}>Recommendations</Text>
        </View>
        <View style={S.metricCard}>
          <Text style={S.metricValue}>{areas.length || "—"}</Text>
          <Text style={S.metricLabel}>Areas Inspected</Text>
        </View>
        <View style={S.metricCardLast}>
          <Text style={[S.metricValue, { color: followUp ? "#ef4444" : "#10b981" }]}>{followUp ? "YES" : "NO"}</Text>
          <Text style={S.metricLabel}>Follow-up Required</Text>
        </View>
      </View>

      {areas.length > 0 ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={S.label}>AREAS INSPECTED</Text>
          <Text style={S.bodyText}>{areas.join("  ·  ")}</Text>
        </View>
      ) : null}

      {report.treatmentNotes ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={S.label}>INSPECTION OVERVIEW</Text>
          <Text style={S.bodyText}>{report.treatmentNotes}</Text>
        </View>
      ) : null}

      {(report.exclusionOpportunities ?? []).length > 0 ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={[S.label, { color: "#3b82f6" }]}>EXCLUSION OPPORTUNITIES</Text>
          {(report.exclusionOpportunities as string[]).map((opp: string, i: number) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
              <Text style={{ fontSize: 8, color: "#3b82f6", marginRight: 6 }}>•</Text>
              <Text style={S.bodyText}>{opp}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <PageFooter company={company} reportNum={reportNum} />
    </Page>
  );
}

function FindingsPage({ findings, branding }: any) {
  const company = branding.companyName ?? "ReadyLoq";
  const reportNum = "Findings";
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title={`Findings  (${findings.length})`} sub="Individual observations from inspection" />
      {(findings as any[]).map((f: any, i: number) => (
        <View key={i} style={S.findingCard} wrap={false}>
          <View style={[S.findingSevBar, { backgroundColor: sevColor(f.severity) }]} />
          <View style={S.findingBody}>
            <Text style={S.findingTitle}>{f.category}</Text>
            <View style={S.findingMeta}>
              {f.severity ? <Text style={[S.findingMetaText, { color: sevColor(f.severity), fontFamily: "Helvetica-Bold" }]}>{f.severity.toUpperCase()}</Text> : null}
              {f.location ? <Text style={S.findingMetaText}>📍 {f.location}</Text> : null}
              {f.confidence ? <Text style={S.findingConf}>{Math.round((f.confidence ?? 0) * 100)}% confidence</Text> : null}
            </View>
            <Text style={S.findingDesc}>{f.description}</Text>
            {f.treatment ? (
              <Text style={[S.findingDesc, { marginTop: 4, color: "#0ea5e9" }]}>Treatment: {f.treatment}</Text>
            ) : null}
          </View>
        </View>
      ))}
      <PageFooter company={company} reportNum={reportNum} />
    </Page>
  );
}

function PhotoEvidencePage({ photos, branding }: any) {
  const company = branding.companyName ?? "ReadyLoq";
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Photo Evidence" sub="Visual documentation captured during inspection" />
      <View style={S.photoGrid}>
        {(photos as any[]).map((p: any, i: number) => (
          <View key={i} style={S.photoCell} wrap={false}>
            <Image src={p.url} style={S.photoImg} />
            {p.caption ? <Text style={S.photoCaption}>{p.caption}</Text> : null}
            <Text style={S.photoMeta}>{fmtDate(p.createdAt)}</Text>
          </View>
        ))}
      </View>
      <PageFooter company={company} reportNum="Evidence" />
    </Page>
  );
}

function RecommendationsPage({ recommendations, exclusionOpps, branding }: any) {
  const company = branding.companyName ?? "ReadyLoq";
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Recommendations" sub="Corrective actions and preventive measures" />
      {(recommendations as string[]).map((rec: string, i: number) => (
        <View key={i} style={S.recItem} wrap={false}>
          <View style={S.recBullet}>
            <Text style={S.recBulletText}>{i + 1}</Text>
          </View>
          <Text style={S.recText}>{rec}</Text>
        </View>
      ))}
      <PageFooter company={company} reportNum="Recommendations" />
    </Page>
  );
}

function TechnicianObservationsPage({ report, inspection, branding }: any) {
  const notes = inspection?.notes;
  const treatment = report.treatmentNotes;
  const voiceNotes = ((inspection?.media ?? []) as any[]).filter((m: any) => m.mediaType === "voice");
  const company = branding.companyName ?? "ReadyLoq";
  const hasAny = notes || treatment || voiceNotes.length > 0;
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Technician Observations" sub="Notes, field observations, and voice recordings" />
      {treatment ? (
        <View style={S.obsBox}>
          <Text style={S.obsBoxLabel}>TREATMENT NOTES</Text>
          <Text style={S.obsBoxText}>{treatment}</Text>
        </View>
      ) : null}
      {notes ? (
        <View style={S.obsBox}>
          <Text style={S.obsBoxLabel}>FIELD NOTES</Text>
          <Text style={S.obsBoxText}>{notes}</Text>
        </View>
      ) : null}
      {voiceNotes.length > 0 ? (
        <View style={S.obsBox}>
          <Text style={S.obsBoxLabel}>VOICE RECORDINGS  ({voiceNotes.length} file{voiceNotes.length !== 1 ? "s" : ""})</Text>
          {voiceNotes.map((v: any, i: number) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
              <Text style={{ fontSize: 8, color: GRAY_500, marginRight: 6 }}>🎙</Text>
              <Text style={[S.obsBoxText, { fontSize: 8 }]}>
                {v.caption ?? v.filename ?? `Voice note ${i + 1}`}
                {v.durationSec ? `  (${Math.round(v.durationSec)}s)` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {!hasAny ? (
        <Text style={[S.bodyText, { color: GRAY_500 }]}>No technician observations recorded for this inspection.</Text>
      ) : null}
      <PageFooter company={company} reportNum="Observations" />
    </Page>
  );
}

function PropertyIntelPage({ propertyFeed, branding }: any) {
  const hotspots = (propertyFeed?.hotspots ?? []) as any[];
  const recurring = (propertyFeed?.recurringIssues ?? []) as any[];
  const knowledge = propertyFeed?.technicianKnowledge;
  const notes = (propertyFeed?.notes ?? []) as any[];
  const company = branding.companyName ?? "ReadyLoq";
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Property Intelligence" internal />
      <View style={S.internalBadge}>
        <Text style={S.internalBadgeText}>INTERNAL USE ONLY — DO NOT SHARE WITH CUSTOMER</Text>
      </View>

      {knowledge ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={S.label}>TECHNICIAN KNOWLEDGE</Text>
          <Text style={S.bodyText}>{knowledge}</Text>
        </View>
      ) : null}

      {hotspots.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>KNOWN HOTSPOTS</Text>
          <View style={[S.tableHeader]}>
            <Text style={[S.tableHeaderText, { width: 110 }]}>ZONE</Text>
            <Text style={[S.tableHeaderText, { width: 52 }]}>SEVERITY</Text>
            <Text style={[S.tableHeaderText, { flex: 1 }]}>DESCRIPTION</Text>
          </View>
          {hotspots.map((h: any, i: number) => (
            <View key={i} style={S.hotspotRow} wrap={false}>
              <View style={[S.hotspotDot, { backgroundColor: sevColor(h.severity) }]} />
              <Text style={S.hotspotZone}>{h.zone}</Text>
              <Text style={S.hotspotSev}>{(h.severity ?? "").toUpperCase()}</Text>
              <Text style={S.hotspotDesc}>{h.description}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {recurring.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>RECURRING ISSUES</Text>
          {recurring.map((r: any, i: number) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }} wrap={false}>
              <Text style={{ fontSize: 8, color: "#ef4444", marginRight: 8 }}>↻</Text>
              <Text style={[S.bodyText, { fontFamily: "Helvetica-Bold", marginRight: 8 }]}>{r.category}</Text>
              <Text style={[S.bodyText, { color: GRAY_500 }]}>{r.count}× recorded</Text>
              {r.severity ? <Text style={[S.bodyText, { color: sevColor(r.severity), marginLeft: 8 }]}>{r.severity}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {notes.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>INTERNAL FIELD NOTES</Text>
          {notes.slice(0, 6).map((n: any, i: number) => (
            <View key={i} style={[S.obsBox, { marginBottom: 8, paddingVertical: 8 }]} wrap={false}>
              {n.zone ? <Text style={[S.obsBoxLabel, { marginBottom: 2 }]}>{n.zone}</Text> : null}
              <Text style={S.obsBoxText}>{n.note}</Text>
              <Text style={[S.obsBoxText, { fontSize: 7, color: GRAY_500, marginTop: 3 }]}>
                {n.authorName ? n.authorName + "  ·  " : ""}{fmtDate(n.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <PageFooter company={company} reportNum="Property Intel" />
    </Page>
  );
}

function ServiceHistoryPage({ propertyFeed, branding }: any) {
  const visits = (propertyFeed?.visitHistory ?? []) as any[];
  const photos = (propertyFeed?.historicalPhotos ?? []) as any[];
  const company = branding.companyName ?? "ReadyLoq";
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Service History" internal />
      <View style={S.internalBadge}>
        <Text style={S.internalBadgeText}>INTERNAL USE ONLY</Text>
      </View>

      {visits.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>VISIT HISTORY  ({visits.length} total)</Text>
          <View style={S.tableHeader}>
            <Text style={[S.tableHeaderText, { width: 90 }]}>DATE</Text>
            <Text style={[S.tableHeaderText, { width: 70 }]}>STATUS</Text>
            <Text style={[S.tableHeaderText, { width: 70 }]}>SEVERITY</Text>
            <Text style={[S.tableHeaderText, { width: 100 }]}>TECHNICIAN</Text>
            <Text style={[S.tableHeaderText, { flex: 1 }]}>FINDINGS</Text>
          </View>
          {visits.map((v: any, i: number) => (
            <View key={i} style={S.tableRow} wrap={false}>
              <Text style={[S.tableCell, { width: 90 }]}>{fmtDate(v.createdAt)}</Text>
              <Text style={[S.tableCell, { width: 70 }]}>{v.status ?? "—"}</Text>
              <Text style={[S.tableCell, { width: 70, color: sevColor(v.severity) }]}>{v.severity ?? "—"}</Text>
              <Text style={[S.tableCell, { width: 100 }]}>{v.technicianName ?? "—"}</Text>
              <Text style={[S.tableCell, { flex: 1 }]}>{v.findingsCount ?? 0}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {photos.length > 0 ? (
        <View>
          <Text style={[S.label, { marginBottom: 10 }]}>HISTORICAL PHOTOS</Text>
          <View style={S.photoGrid}>
            {photos.slice(0, 6).map((p: any, i: number) => (
              <View key={i} style={S.photoCell} wrap={false}>
                <Image src={p.url} style={S.photoImg} />
                {p.caption ? <Text style={S.photoCaption}>{p.caption}</Text> : null}
                <Text style={S.photoMeta}>{fmtDate(p.createdAt)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {visits.length === 0 && photos.length === 0 ? (
        <Text style={[S.bodyText, { color: GRAY_500 }]}>No service history available for this property.</Text>
      ) : null}

      <PageFooter company={company} reportNum="Service History" />
    </Page>
  );
}

function ManagementInsightsPage({ findings, propertyFeed, branding }: any) {
  const recurring = (propertyFeed?.recurringIssues ?? []) as any[];
  const visits = (propertyFeed?.visitHistory ?? []) as any[];
  const company = branding.companyName ?? "ReadyLoq";

  const highRisk = (findings as any[]).filter((f: any) => f.severity === "critical" || f.severity === "high");
  const callbackIndicators = recurring.filter((r: any) => (r.count ?? 0) >= 3);
  const repeatIssues = recurring.filter((r: any) => (r.count ?? 0) >= 2);

  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Management Insights" internal />
      <View style={S.internalBadge}>
        <Text style={S.internalBadgeText}>INTERNAL USE ONLY</Text>
      </View>

      <View style={{ flexDirection: "row", marginBottom: 24 }}>
        <View style={[S.metricCard, { flex: 1 }]}>
          <Text style={[S.metricValue, { color: highRisk.length > 0 ? "#ef4444" : "#10b981" }]}>{highRisk.length}</Text>
          <Text style={S.metricLabel}>High-Risk Findings</Text>
        </View>
        <View style={[S.metricCard, { flex: 1 }]}>
          <Text style={[S.metricValue, { color: callbackIndicators.length > 0 ? "#f97316" : "#10b981" }]}>{callbackIndicators.length}</Text>
          <Text style={S.metricLabel}>Callback Indicators</Text>
        </View>
        <View style={[S.metricCard, { flex: 1 }]}>
          <Text style={[S.metricValue, { color: repeatIssues.length > 0 ? AMBER : "#10b981" }]}>{repeatIssues.length}</Text>
          <Text style={S.metricLabel}>Repeat Issues</Text>
        </View>
        <View style={[S.metricCardLast, { flex: 1 }]}>
          <Text style={S.metricValue}>{visits.length}</Text>
          <Text style={S.metricLabel}>Total Service Visits</Text>
        </View>
      </View>

      {callbackIndicators.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={[S.label, { color: "#f97316", marginBottom: 8 }]}>⚠ CALLBACK RISK INDICATORS</Text>
          {callbackIndicators.map((r: any, i: number) => (
            <View key={i} style={[S.obsBox, { marginBottom: 6, paddingVertical: 8, backgroundColor: "#fff7ed" }]} wrap={false}>
              <Text style={[S.obsBoxLabel, { color: "#f97316" }]}>{r.category}  —  {r.count} occurrences</Text>
              {r.description ? <Text style={S.obsBoxText}>{r.description}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {repeatIssues.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>REPEAT ISSUE INDICATORS</Text>
          {repeatIssues.map((r: any, i: number) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <Text style={{ fontSize: 8, color: AMBER, width: 14 }}>↻</Text>
              <Text style={[S.bodyText, { fontFamily: "Helvetica-Bold", flex: 1 }]}>{r.category}</Text>
              <Text style={[S.bodyText, { color: GRAY_500 }]}>{r.count} visits with this issue</Text>
            </View>
          ))}
        </View>
      ) : null}

      {visits.length >= 3 ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={[S.label, { marginBottom: 8 }]}>RISK TREND (last {Math.min(visits.length, 6)} visits)</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: 60 }}>
            {visits.slice(0, 6).reverse().map((v: any, i: number) => {
              const h = v.severity === "critical" ? 60 : v.severity === "high" ? 45 : v.severity === "medium" ? 28 : 12;
              return (
                <View key={i} style={{ flex: 1, alignItems: "center", marginRight: 4 }}>
                  <View style={{ height: h, backgroundColor: sevColor(v.severity), borderRadius: 2 }} />
                  <Text style={{ fontSize: 6, color: GRAY_500, marginTop: 3 }}>
                    {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short" })}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {recurring.length === 0 && highRisk.length === 0 ? (
        <Text style={[S.bodyText, { color: GRAY_500 }]}>No significant risk indicators identified for this property.</Text>
      ) : null}

      <PageFooter company={company} reportNum="Insights" />
    </Page>
  );
}

function SignaturePage({ report, branding, dateStr }: any) {
  const company = branding.companyName ?? "ReadyLoq";
  const reportNum = `RPT-${String(report.id).padStart(4, "0")}`;
  return (
    <Page size="LETTER" style={S.page}>
      <SectionHeader title="Sign-Off" sub="Certification of inspection completion" />

      <Text style={[S.bodyText, { marginBottom: 24 }]}>
        This report certifies that a pest control inspection was conducted at{" "}
        <Text style={{ fontFamily: "Helvetica-Bold" }}>{report.siteAddress}</Text>{" "}
        on <Text style={{ fontFamily: "Helvetica-Bold" }}>{dateStr}</Text>. All findings and
        recommendations documented herein represent conditions observed during this inspection.
      </Text>

      <View style={{ flexDirection: "row", marginBottom: 48 }}>
        <View style={S.sigBlock}>
          <Text style={[S.label, { marginBottom: 4 }]}>TECHNICIAN SIGNATURE</Text>
          <View style={S.sigSpacer} />
          <View style={S.sigLine} />
          <Text style={S.sigName}>{report.technicianName}</Text>
          <Text style={S.sigRole}>Certified Pest Control Technician</Text>
        </View>
        <View style={S.sigBlock}>
          <Text style={[S.label, { marginBottom: 4 }]}>CLIENT SIGNATURE</Text>
          <View style={S.sigSpacer} />
          <View style={S.sigLine} />
          <Text style={S.sigName}>Authorized Representative</Text>
          <Text style={S.sigRole}>Date: {dateStr}</Text>
        </View>
      </View>

      <View style={S.divider} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
        <View>
          <Text style={[S.label, { marginBottom: 2 }]}>{company.toUpperCase()}</Text>
          {branding.supportEmail ? <Text style={S.bodyText}>{branding.supportEmail}</Text> : null}
          {branding.supportPhone ? <Text style={S.bodyText}>{branding.supportPhone}</Text> : null}
          {branding.tagline ? <Text style={[S.bodyText, { color: TEAL, fontFamily: "Helvetica-Oblique", marginTop: 4 }]}>{branding.tagline}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={S.bodyText}>{reportNum}</Text>
          {branding.poweredByVisible !== false ? (
            <Text style={[S.bodyText, { color: GRAY_500, marginTop: 4 }]}>Powered by ReadyLoq</Text>
          ) : null}
        </View>
      </View>
      <PageFooter company={company} reportNum={reportNum} />
    </Page>
  );
}

export interface ReportPDFProps {
  report: any;
  inspection: any;
  branding: any;
  propertyFeed?: any;
  mode: ReportMode;
}

export function ReportPDF({ report, inspection, branding, propertyFeed, mode }: ReportPDFProps) {
  const findings = (report.findings ?? []) as any[];
  const recommendations = (report.recommendations ?? []) as string[];
  const exclusionOpps = (report.exclusionOpportunities ?? []) as string[];
  const photos = ((inspection?.media ?? []) as any[]).filter((m: any) => m.mediaType === "photo");
  const dateStr = fmtDate(report.inspectionDate);
  const reportNum = `RPT-${String(report.id).padStart(4, "0")}`;
  const company = branding.companyName ?? "ReadyLoq";

  return (
    <Document
      title={report.title}
      author={company}
      subject="Pest Control Inspection Report"
      creator="ReadyLoq"
    >
      <CoverPage report={report} branding={branding} dateStr={dateStr} reportNum={reportNum} mode={mode} />

      <ExecutiveSummaryPage
        report={report}
        findings={findings}
        recommendations={recommendations}
        inspection={inspection}
        branding={branding}
      />

      {findings.length > 0 && (
        <FindingsPage findings={findings} branding={branding} />
      )}

      {photos.length > 0 && (
        <PhotoEvidencePage photos={photos} branding={branding} />
      )}

      {recommendations.length > 0 && (
        <RecommendationsPage
          recommendations={recommendations}
          exclusionOpps={exclusionOpps}
          branding={branding}
        />
      )}

      <TechnicianObservationsPage report={report} inspection={inspection} branding={branding} />

      {mode === "internal" && (
        <>
          <PropertyIntelPage propertyFeed={propertyFeed} branding={branding} />
          <ServiceHistoryPage propertyFeed={propertyFeed} branding={branding} />
          <ManagementInsightsPage findings={findings} propertyFeed={propertyFeed} branding={branding} />
        </>
      )}

      <SignaturePage report={report} branding={branding} dateStr={dateStr} />
    </Document>
  );
}
