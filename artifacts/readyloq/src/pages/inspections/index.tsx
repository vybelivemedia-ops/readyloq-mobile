import { useListInspections } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Search, Filter, AlertCircle, FileText, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function InspectionsList() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: inspections, isLoading } = useListInspections();

  const filteredInspections = inspections?.filter(i =>
    i.siteAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.technicianName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.clientName && i.clientName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20';
      case 'in-progress': return 'bg-amber-500/15 text-amber-500 border-amber-500/20';
      case 'pending': return 'bg-blue-500/15 text-blue-500 border-blue-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getSeverityColor = (severity?: string | null) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'text-red-500';
      case 'high': return 'text-orange-500';
      case 'medium': return 'text-amber-500';
      case 'low': return 'text-emerald-500';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Inspections</h1>
          <p className="text-muted-foreground mt-1">Manage field operations and data collection.</p>
        </div>
        <Link href="/inspections/new">
          <Button className="w-full sm:w-auto shadow-md">
            <Plus className="mr-2 h-4 w-4" />
            New Inspection
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 flex-shrink-0">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search site, client, or tech..."
            className="w-full pl-9 bg-card border-border/50 focus-visible:ring-primary/50"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="w-full sm:w-auto bg-card border-border/50">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>

      <div className="border border-border/50 rounded-lg bg-card flex-1 overflow-hidden flex flex-col shadow-sm">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-muted/30 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow className="border-border/50">
                <TableHead>Site Address</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Findings</TableHead>
                <TableHead className="w-[50px]"></TableHead>
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
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : filteredInspections?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <FileText className="h-10 w-10 mb-2 opacity-20" />
                      <p>No inspections found.</p>
                      {searchTerm && <p className="text-sm mt-1">Try adjusting your search query.</p>}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInspections?.map((inspection) => (
                  <TableRow key={inspection.id} className="border-border/30 hover:bg-muted/30 group">
                    <TableCell className="font-medium">
                      <Link href={`/inspections/${inspection.id}`} className="hover:underline">
                        {inspection.siteAddress}
                      </Link>
                      {inspection.clientName && (
                        <p className="text-xs text-muted-foreground mt-1 font-normal">{inspection.clientName}</p>
                      )}
                    </TableCell>
                    <TableCell>{inspection.technicianName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inspection.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-medium ${getStatusColor(inspection.status)} border capitalize`}>
                        {inspection.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {inspection.severity ? (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className={`h-4 w-4 ${getSeverityColor(inspection.severity)}`} />
                          <span className="capitalize text-sm">{inspection.severity}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-center bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-semibold">
                        {inspection.findingsCount || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          <DropdownMenuItem asChild>
                            <Link href={`/inspections/${inspection.id}`}>View Details</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem>Generate Report</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
