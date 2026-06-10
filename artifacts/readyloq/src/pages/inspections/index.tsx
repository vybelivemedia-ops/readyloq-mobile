import { useListInspections } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Search, AlertCircle, FileText, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function statusStyle(status: string) {
  switch (status.toLowerCase()) {
    case "completed":  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
    case "in-progress": return "bg-amber-500/15 text-amber-400 border-amber-500/20";
    case "pending":    return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    default:           return "bg-muted text-muted-foreground border-border";
  }
}

function statusDot(status: string) {
  switch (status.toLowerCase()) {
    case "completed":   return "bg-emerald-500";
    case "in-progress": return "bg-amber-500";
    default:            return "bg-blue-500";
  }
}

function severityColor(severity?: string | null) {
  switch (severity?.toLowerCase()) {
    case "critical": return "text-red-400";
    case "high":     return "text-orange-400";
    case "medium":   return "text-amber-400";
    case "low":      return "text-emerald-400";
    default:         return "text-muted-foreground";
  }
}

export default function InspectionsList() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: inspections, isLoading } = useListInspections();

  const filtered = inspections?.filter(i =>
    i.siteAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.technicianName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.clientName && i.clientName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden md:block">Manage field operations and data collection.</p>
        </div>
        <Link href="/inspections/new">
          <Button className="rounded-xl shadow-md shadow-primary/20 h-10 px-4 font-semibold shrink-0">
            <Plus className="mr-1.5 h-4 w-4" />
            New Inspection
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search site, client, or tech..."
            className="pl-9 bg-card border-border/60 rounded-xl h-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="h-10 px-3 rounded-xl border-border/60 bg-card">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {/* ── MOBILE CARD LIST (hidden on md+) ── */}
      <div className="md:hidden space-y-2.5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border/60 rounded-2xl p-4 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2 mt-1">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))
        ) : filtered?.length === 0 ? (
          <div className="bg-card border border-border/60 rounded-2xl p-10 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No inspections found.</p>
          </div>
        ) : (
          filtered?.map((insp) => (
            <Link key={insp.id} href={`/inspections/${insp.id}`}>
              <div className="bg-card border border-border/60 rounded-2xl px-4 py-3.5 active:bg-primary/5 transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Address */}
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", statusDot(insp.status))} />
                      <p className="text-sm font-semibold leading-tight truncate">{insp.siteAddress}</p>
                    </div>
                    {insp.clientName && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 ml-4">{insp.clientName}</p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap ml-4">
                      <span className="text-[11px] text-muted-foreground">{insp.technicianName}</span>
                      <span className="text-muted-foreground/40 text-[11px]">·</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(insp.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      {insp.severity && (
                        <>
                          <span className="text-muted-foreground/40 text-[11px]">·</span>
                          <span className={cn("text-[11px] font-semibold capitalize", severityColor(insp.severity))}>
                            {insp.severity}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant="outline" className={cn("text-[10px] font-semibold capitalize px-2 py-0.5 border rounded-full", statusStyle(insp.status))}>
                      {insp.status}
                    </Badge>
                    {(insp.findingsCount ?? 0) > 0 && (
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {insp.findingsCount} findings
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* ── DESKTOP TABLE (hidden on mobile) ── */}
      <div className="hidden md:block border border-border/50 rounded-2xl bg-card overflow-hidden shadow-sm">
        <div className="overflow-auto">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="border-border/50">
                <TableHead>Site Address</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Findings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/30">
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>No inspections found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered?.map((insp) => (
                  <TableRow key={insp.id} className="border-border/30 hover:bg-muted/20 cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/inspections/${insp.id}`} className="hover:text-primary transition-colors">
                        {insp.siteAddress}
                      </Link>
                      {insp.clientName && (
                        <p className="text-xs text-muted-foreground mt-0.5 font-normal">{insp.clientName}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{insp.technicianName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(insp.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("font-medium border capitalize text-xs", statusStyle(insp.status))}>
                        {insp.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {insp.severity ? (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className={cn("h-3.5 w-3.5", severityColor(insp.severity))} />
                          <span className={cn("capitalize text-sm", severityColor(insp.severity))}>{insp.severity}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-center bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-semibold">
                        {insp.findingsCount || 0}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
