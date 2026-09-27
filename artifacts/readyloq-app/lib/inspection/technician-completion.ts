export interface TechnicianCompletionDependencies {
  drainPendingIngestion: () => Promise<void>;
  persistLocalCompletion: () => Promise<string>;
  navigateToSummary: (localId: string) => void;
  continueSyncInBackground: (localId: string) => void;
}

/**
 * The technician's completion boundary is durable local evidence, not AI.
 *
 * Ingestion and the atomic local completion write must finish before navigation.
 * Upload, media registration, AI analysis, and server finalization continue
 * through the existing sync engine after the summary is shown.
 */
export async function completeTechnicianWorkflow({
  drainPendingIngestion,
  persistLocalCompletion,
  navigateToSummary,
  continueSyncInBackground,
}: TechnicianCompletionDependencies): Promise<void> {
  await drainPendingIngestion();
  const localId = await persistLocalCompletion();
  navigateToSummary(localId);
  continueSyncInBackground(localId);
}