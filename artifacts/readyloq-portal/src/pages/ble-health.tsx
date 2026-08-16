import { useState, useMemo } from 'react';
import { useFrameDropStats, type FrameDropStat } from '@/hooks/use-ble-health';
import { Loader2, Wifi, WifiOff, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

type SortKey = 'deviceId' | 'reason' | 'dropCount';
type SortDir = 'asc' | 'desc';

function severityBadge(dropCount: number) {
  if (dropCount >= 50) return 'bg-red-500/15 text-red-400 border border-red-500/30';
  if (dropCount >= 10) return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30';
  return 'bg-green-500/15 text-green-400 border border-green-500/30';
}

function severityLabel(dropCount: number) {
  if (dropCount >= 50) return 'High';
  if (dropCount >= 10) return 'Medium';
  return 'Low';
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5" />
    : <ChevronDown className="w-3.5 h-3.5" />;
}

export function BleHealth() {
  const { data, isLoading, isError, refetch, isFetching } = useFrameDropStats();
  const [sortKey, setSortKey] = useState<SortKey>('dropCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir(col === 'dropCount' ? 'desc' : 'asc');
    }
  }

  const sorted = useMemo<FrameDropStat[]>(() => {
    if (!data?.stats) return [];
    return [...data.stats].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'dropCount') {
        cmp = a.dropCount - b.dropCount;
      } else {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.stats, sortKey, sortDir]);

  const totalDrops = data?.stats.reduce((sum, s) => sum + s.dropCount, 0) ?? 0;
  const uniqueDevices = new Set(data?.stats.map((s) => s.deviceId).filter(Boolean)).size;

  const thClass =
    'px-6 py-3 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors';

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wifi className="w-7 h-7 text-primary" />
            BLE Device Health
          </h1>
          <p className="text-muted-foreground mt-1">
            Frame-drop telemetry aggregated from smart glasses sessions. Identify hardware producing the most drops.
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary tiles */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">Total Frame Drops</p>
            <p className="text-3xl font-bold mt-2 text-destructive">{totalDrops.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">Devices Reporting Drops</p>
            <p className="text-3xl font-bold mt-2">{uniqueDevices}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">Last Queried</p>
            <p className="text-xl font-semibold mt-2">
              {new Date(data.queriedAt).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <WifiOff className="w-12 h-12" />
          <p className="text-sm">Failed to load frame-drop stats. Make sure the API server is reachable.</p>
          <button
            onClick={() => void refetch()}
            className="text-sm text-primary underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : !data || data.stats.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Wifi className="w-12 h-12 text-green-500" />
          <p className="font-medium text-foreground">No frame drops recorded</p>
          <p className="text-sm">All glasses sessions for this company have clean BLE links.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold">Drop Count by Device &amp; Reason</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click a column header to sort. Devices with ≥50 drops are highlighted red.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className={`text-left ${thClass}`} onClick={() => handleSort('deviceId')}>
                    <span className="flex items-center gap-1">
                      Device ID
                      <SortIcon col="deviceId" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th className={`text-left ${thClass}`} onClick={() => handleSort('reason')}>
                    <span className="flex items-center gap-1">
                      Reason
                      <SortIcon col="reason" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th className={`text-right ${thClass}`} onClick={() => handleSort('dropCount')}>
                    <span className="flex items-center justify-end gap-1">
                      Drop Count
                      <SortIcon col="dropCount" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">
                    Severity
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-6 py-3 font-mono text-xs text-foreground">
                      {row.deviceId ?? <span className="text-muted-foreground italic">unknown</span>}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {row.reason ?? <span className="italic">—</span>}
                    </td>
                    <td className="px-6 py-3 text-right font-bold tabular-nums">
                      {row.dropCount.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${severityBadge(row.dropCount)}`}>
                        {severityLabel(row.dropCount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
