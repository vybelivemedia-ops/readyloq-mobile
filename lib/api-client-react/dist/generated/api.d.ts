import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AnalysisResult, AnalysisSummary, AnalyticsDashboard, AnalyzeInspectionInput, BetaFeedback, BrandingProfile, BrandingProfileInput, CallbackIntelligence, ChecklistResponse, ChecklistToggleResult, ClientErrorInput, CompleteInspectionResult, CreateInviteInput, CustomerSummary, CustomerSummaryApprove, CustomerSummaryUpdate, DatasetCategory, DatasetPage, Error, ErrorEventList, FeedbackInput, GeminiConversation, GeminiConversationInput, GeminiConversationWithMessages, GeminiError, GeminiImageInput, GeminiImageOutput, GeminiMessage, GeminiMessageInput, GenerateNarrativeInput, GetAnalyticsTrendsParams, HealthStatus, InfestationRisk, Inspection, InspectionInput, InspectionMedia, InspectionScorecard, InspectionScorecardListItem, InspectionUpdate, IntelligenceAnalytics, IntelligenceCategory, IntelligenceConfirmInput, IntelligenceRecord, IntelligenceRecordInput, IntelligenceRecordPage, IntelligenceReviewInput, IntelligenceSettings, IntelligenceSettingsInput, IntelligenceVoteInput, Invite, Lead, LeadInput, ListAnalysisResultsParams, ListDatasetImagesParams, ListFeedbackParams, ListInspectionsParams, ListIntelligenceRecordsParams, ListProposalsParams, ListSalesOpportunitiesParams, ListScorecardsParams, LookupPropertyParams, MediaInput, OkResponse, OpportunityIntelligence, OpportunityNote, OpportunityNoteCreate, OpportunitySettings, OpportunitySettingsUpdate, PropertyFeed, PropertyLookupResult, PropertyNote, PropertyNoteInput, PropertyProfileUpdate, PropertyRiskInsights, PropertySummary, Report, ReportInput, RoleBriefing, SalesOpportunity, SalesOpportunityDetail, SalesOpportunityTrends, SalesOpportunityUpdate, SalesProposal, SalesProposalCreate, SalesProposalDetail, SalesProposalUpdate, ScorecardSummary, SubmitFeedbackInput, TechnicianPerformance, Tester, TesterAccessResult, ToggleAccessInput, ToggleChecklistInput, TrendDataPoint, UpdateFeedbackInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListInspectionsUrl: (params?: ListInspectionsParams) => string;
/**
 * @summary List all inspections
 */
export declare const listInspections: (params?: ListInspectionsParams, options?: RequestInit) => Promise<Inspection[]>;
export declare const getListInspectionsQueryKey: (params?: ListInspectionsParams) => readonly ["/api/inspections", ...ListInspectionsParams[]];
export declare const getListInspectionsQueryOptions: <TData = Awaited<ReturnType<typeof listInspections>>, TError = ErrorType<unknown>>(params?: ListInspectionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listInspections>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listInspections>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListInspectionsQueryResult = NonNullable<Awaited<ReturnType<typeof listInspections>>>;
export type ListInspectionsQueryError = ErrorType<unknown>;
/**
 * @summary List all inspections
 */
export declare function useListInspections<TData = Awaited<ReturnType<typeof listInspections>>, TError = ErrorType<unknown>>(params?: ListInspectionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listInspections>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateInspectionUrl: () => string;
/**
 * @summary Create a new inspection
 */
export declare const createInspection: (inspectionInput: InspectionInput, options?: RequestInit) => Promise<Inspection>;
export declare const getCreateInspectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInspection>>, TError, {
        data: BodyType<InspectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createInspection>>, TError, {
    data: BodyType<InspectionInput>;
}, TContext>;
export type CreateInspectionMutationResult = NonNullable<Awaited<ReturnType<typeof createInspection>>>;
export type CreateInspectionMutationBody = BodyType<InspectionInput>;
export type CreateInspectionMutationError = ErrorType<unknown>;
/**
* @summary Create a new inspection
*/
export declare const useCreateInspection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInspection>>, TError, {
        data: BodyType<InspectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createInspection>>, TError, {
    data: BodyType<InspectionInput>;
}, TContext>;
export declare const getGetInspectionUrl: (id: number) => string;
/**
 * @summary Get inspection by ID
 */
export declare const getInspection: (id: number, options?: RequestInit) => Promise<Inspection>;
export declare const getGetInspectionQueryKey: (id: number) => readonly [`/api/inspections/${number}`];
export declare const getGetInspectionQueryOptions: <TData = Awaited<ReturnType<typeof getInspection>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInspection>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getInspection>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetInspectionQueryResult = NonNullable<Awaited<ReturnType<typeof getInspection>>>;
export type GetInspectionQueryError = ErrorType<unknown>;
/**
 * @summary Get inspection by ID
 */
export declare function useGetInspection<TData = Awaited<ReturnType<typeof getInspection>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInspection>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateInspectionUrl: (id: number) => string;
/**
 * @summary Update inspection
 */
export declare const updateInspection: (id: number, inspectionUpdate: InspectionUpdate, options?: RequestInit) => Promise<Inspection>;
export declare const getUpdateInspectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateInspection>>, TError, {
        id: number;
        data: BodyType<InspectionUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateInspection>>, TError, {
    id: number;
    data: BodyType<InspectionUpdate>;
}, TContext>;
export type UpdateInspectionMutationResult = NonNullable<Awaited<ReturnType<typeof updateInspection>>>;
export type UpdateInspectionMutationBody = BodyType<InspectionUpdate>;
export type UpdateInspectionMutationError = ErrorType<unknown>;
/**
* @summary Update inspection
*/
export declare const useUpdateInspection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateInspection>>, TError, {
        id: number;
        data: BodyType<InspectionUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateInspection>>, TError, {
    id: number;
    data: BodyType<InspectionUpdate>;
}, TContext>;
export declare const getDeleteInspectionUrl: (id: number) => string;
/**
 * @summary Delete inspection
 */
export declare const deleteInspection: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteInspectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteInspection>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteInspection>>, TError, {
    id: number;
}, TContext>;
export type DeleteInspectionMutationResult = NonNullable<Awaited<ReturnType<typeof deleteInspection>>>;
export type DeleteInspectionMutationError = ErrorType<unknown>;
/**
* @summary Delete inspection
*/
export declare const useDeleteInspection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteInspection>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteInspection>>, TError, {
    id: number;
}, TContext>;
export declare const getCompleteInspectionUrl: (id: number) => string;
/**
 * @summary Explicitly complete an in-progress inspection and trigger the finalization pipeline (report, AI narrative, customer summary draft, Opportunity Intelligence, scorecard). Idempotent.

 */
export declare const completeInspection: (id: number, options?: RequestInit) => Promise<CompleteInspectionResult>;
export declare const getCompleteInspectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeInspection>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completeInspection>>, TError, {
    id: number;
}, TContext>;
export type CompleteInspectionMutationResult = NonNullable<Awaited<ReturnType<typeof completeInspection>>>;
export type CompleteInspectionMutationError = ErrorType<unknown>;
/**
* @summary Explicitly complete an in-progress inspection and trigger the finalization pipeline (report, AI narrative, customer summary draft, Opportunity Intelligence, scorecard). Idempotent.

*/
export declare const useCompleteInspection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeInspection>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completeInspection>>, TError, {
    id: number;
}, TContext>;
export declare const getAddInspectionMediaUrl: (id: number) => string;
/**
 * @summary Add media to inspection
 */
export declare const addInspectionMedia: (id: number, mediaInput: MediaInput, options?: RequestInit) => Promise<InspectionMedia>;
export declare const getAddInspectionMediaMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addInspectionMedia>>, TError, {
        id: number;
        data: BodyType<MediaInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addInspectionMedia>>, TError, {
    id: number;
    data: BodyType<MediaInput>;
}, TContext>;
export type AddInspectionMediaMutationResult = NonNullable<Awaited<ReturnType<typeof addInspectionMedia>>>;
export type AddInspectionMediaMutationBody = BodyType<MediaInput>;
export type AddInspectionMediaMutationError = ErrorType<unknown>;
/**
* @summary Add media to inspection
*/
export declare const useAddInspectionMedia: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addInspectionMedia>>, TError, {
        id: number;
        data: BodyType<MediaInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addInspectionMedia>>, TError, {
    id: number;
    data: BodyType<MediaInput>;
}, TContext>;
export declare const getListAnalysisResultsUrl: (params?: ListAnalysisResultsParams) => string;
/**
 * @summary List AI analysis results
 */
export declare const listAnalysisResults: (params?: ListAnalysisResultsParams, options?: RequestInit) => Promise<AnalysisResult[]>;
export declare const getListAnalysisResultsQueryKey: (params?: ListAnalysisResultsParams) => readonly ["/api/analysis", ...ListAnalysisResultsParams[]];
export declare const getListAnalysisResultsQueryOptions: <TData = Awaited<ReturnType<typeof listAnalysisResults>>, TError = ErrorType<unknown>>(params?: ListAnalysisResultsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAnalysisResults>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAnalysisResults>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAnalysisResultsQueryResult = NonNullable<Awaited<ReturnType<typeof listAnalysisResults>>>;
export type ListAnalysisResultsQueryError = ErrorType<unknown>;
/**
 * @summary List AI analysis results
 */
export declare function useListAnalysisResults<TData = Awaited<ReturnType<typeof listAnalysisResults>>, TError = ErrorType<unknown>>(params?: ListAnalysisResultsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAnalysisResults>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAnalyzeInspectionUrl: () => string;
/**
 * @summary Run real AI vision analysis on captured inspection photos
 */
export declare const analyzeInspection: (analyzeInspectionInput: AnalyzeInspectionInput, options?: RequestInit) => Promise<AnalysisResult>;
export declare const getAnalyzeInspectionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof analyzeInspection>>, TError, {
        data: BodyType<AnalyzeInspectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof analyzeInspection>>, TError, {
    data: BodyType<AnalyzeInspectionInput>;
}, TContext>;
export type AnalyzeInspectionMutationResult = NonNullable<Awaited<ReturnType<typeof analyzeInspection>>>;
export type AnalyzeInspectionMutationBody = BodyType<AnalyzeInspectionInput>;
export type AnalyzeInspectionMutationError = ErrorType<unknown>;
/**
* @summary Run real AI vision analysis on captured inspection photos
*/
export declare const useAnalyzeInspection: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof analyzeInspection>>, TError, {
        data: BodyType<AnalyzeInspectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof analyzeInspection>>, TError, {
    data: BodyType<AnalyzeInspectionInput>;
}, TContext>;
export declare const getGetAnalysisResultUrl: (id: number) => string;
/**
 * @summary Get analysis result
 */
export declare const getAnalysisResult: (id: number, options?: RequestInit) => Promise<AnalysisResult>;
export declare const getGetAnalysisResultQueryKey: (id: number) => readonly [`/api/analysis/${number}`];
export declare const getGetAnalysisResultQueryOptions: <TData = Awaited<ReturnType<typeof getAnalysisResult>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisResult>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAnalysisResult>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAnalysisResultQueryResult = NonNullable<Awaited<ReturnType<typeof getAnalysisResult>>>;
export type GetAnalysisResultQueryError = ErrorType<unknown>;
/**
 * @summary Get analysis result
 */
export declare function useGetAnalysisResult<TData = Awaited<ReturnType<typeof getAnalysisResult>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisResult>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSubmitAnalysisFeedbackUrl: (id: number) => string;
/**
 * @summary Submit technician feedback on analysis
 */
export declare const submitAnalysisFeedback: (id: number, feedbackInput: FeedbackInput, options?: RequestInit) => Promise<AnalysisResult>;
export declare const getSubmitAnalysisFeedbackMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitAnalysisFeedback>>, TError, {
        id: number;
        data: BodyType<FeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof submitAnalysisFeedback>>, TError, {
    id: number;
    data: BodyType<FeedbackInput>;
}, TContext>;
export type SubmitAnalysisFeedbackMutationResult = NonNullable<Awaited<ReturnType<typeof submitAnalysisFeedback>>>;
export type SubmitAnalysisFeedbackMutationBody = BodyType<FeedbackInput>;
export type SubmitAnalysisFeedbackMutationError = ErrorType<unknown>;
/**
* @summary Submit technician feedback on analysis
*/
export declare const useSubmitAnalysisFeedback: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitAnalysisFeedback>>, TError, {
        id: number;
        data: BodyType<FeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof submitAnalysisFeedback>>, TError, {
    id: number;
    data: BodyType<FeedbackInput>;
}, TContext>;
export declare const getGetAnalysisSummaryUrl: () => string;
/**
 * @summary Get aggregated AI analysis summary
 */
export declare const getAnalysisSummary: (options?: RequestInit) => Promise<AnalysisSummary>;
export declare const getGetAnalysisSummaryQueryKey: () => readonly ["/api/analysis/summary"];
export declare const getGetAnalysisSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getAnalysisSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAnalysisSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAnalysisSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getAnalysisSummary>>>;
export type GetAnalysisSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get aggregated AI analysis summary
 */
export declare function useGetAnalysisSummary<TData = Awaited<ReturnType<typeof getAnalysisSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalysisSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListDatasetImagesUrl: (params?: ListDatasetImagesParams) => string;
/**
 * @summary List dataset library images
 */
export declare const listDatasetImages: (params?: ListDatasetImagesParams, options?: RequestInit) => Promise<DatasetPage>;
export declare const getListDatasetImagesQueryKey: (params?: ListDatasetImagesParams) => readonly ["/api/dataset", ...ListDatasetImagesParams[]];
export declare const getListDatasetImagesQueryOptions: <TData = Awaited<ReturnType<typeof listDatasetImages>>, TError = ErrorType<unknown>>(params?: ListDatasetImagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDatasetImages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listDatasetImages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListDatasetImagesQueryResult = NonNullable<Awaited<ReturnType<typeof listDatasetImages>>>;
export type ListDatasetImagesQueryError = ErrorType<unknown>;
/**
 * @summary List dataset library images
 */
export declare function useListDatasetImages<TData = Awaited<ReturnType<typeof listDatasetImages>>, TError = ErrorType<unknown>>(params?: ListDatasetImagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDatasetImages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListDatasetCategoriesUrl: () => string;
/**
 * @summary List all dataset categories with counts
 */
export declare const listDatasetCategories: (options?: RequestInit) => Promise<DatasetCategory[]>;
export declare const getListDatasetCategoriesQueryKey: () => readonly ["/api/dataset/categories"];
export declare const getListDatasetCategoriesQueryOptions: <TData = Awaited<ReturnType<typeof listDatasetCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDatasetCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listDatasetCategories>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListDatasetCategoriesQueryResult = NonNullable<Awaited<ReturnType<typeof listDatasetCategories>>>;
export type ListDatasetCategoriesQueryError = ErrorType<unknown>;
/**
 * @summary List all dataset categories with counts
 */
export declare function useListDatasetCategories<TData = Awaited<ReturnType<typeof listDatasetCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDatasetCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListIntelligenceCategoriesUrl: () => string;
/**
 * @summary Taxonomy groups + subcategories with per-company counts
 */
export declare const listIntelligenceCategories: (options?: RequestInit) => Promise<IntelligenceCategory[]>;
export declare const getListIntelligenceCategoriesQueryKey: () => readonly ["/api/intelligence-dataset/categories"];
export declare const getListIntelligenceCategoriesQueryOptions: <TData = Awaited<ReturnType<typeof listIntelligenceCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceCategories>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListIntelligenceCategoriesQueryResult = NonNullable<Awaited<ReturnType<typeof listIntelligenceCategories>>>;
export type ListIntelligenceCategoriesQueryError = ErrorType<unknown>;
/**
 * @summary Taxonomy groups + subcategories with per-company counts
 */
export declare function useListIntelligenceCategories<TData = Awaited<ReturnType<typeof listIntelligenceCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetIntelligenceSettingsUrl: () => string;
/**
 * @summary Get the company's intelligence sharing participation setting
 */
export declare const getIntelligenceSettings: (options?: RequestInit) => Promise<IntelligenceSettings>;
export declare const getGetIntelligenceSettingsQueryKey: () => readonly ["/api/intelligence-dataset/settings"];
export declare const getGetIntelligenceSettingsQueryOptions: <TData = Awaited<ReturnType<typeof getIntelligenceSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntelligenceSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getIntelligenceSettings>>>;
export type GetIntelligenceSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Get the company's intelligence sharing participation setting
 */
export declare function useGetIntelligenceSettings<TData = Awaited<ReturnType<typeof getIntelligenceSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateIntelligenceSettingsUrl: () => string;
/**
 * @summary Update the company's sharing participation (manager+)
 */
export declare const updateIntelligenceSettings: (intelligenceSettingsInput: IntelligenceSettingsInput, options?: RequestInit) => Promise<IntelligenceSettings>;
export declare const getUpdateIntelligenceSettingsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateIntelligenceSettings>>, TError, {
        data: BodyType<IntelligenceSettingsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateIntelligenceSettings>>, TError, {
    data: BodyType<IntelligenceSettingsInput>;
}, TContext>;
export type UpdateIntelligenceSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof updateIntelligenceSettings>>>;
export type UpdateIntelligenceSettingsMutationBody = BodyType<IntelligenceSettingsInput>;
export type UpdateIntelligenceSettingsMutationError = ErrorType<unknown>;
/**
* @summary Update the company's sharing participation (manager+)
*/
export declare const useUpdateIntelligenceSettings: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateIntelligenceSettings>>, TError, {
        data: BodyType<IntelligenceSettingsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateIntelligenceSettings>>, TError, {
    data: BodyType<IntelligenceSettingsInput>;
}, TContext>;
export declare const getGetIntelligenceAnalyticsUrl: () => string;
/**
 * @summary Per-company intelligence dataset analytics
 */
export declare const getIntelligenceAnalytics: (options?: RequestInit) => Promise<IntelligenceAnalytics>;
export declare const getGetIntelligenceAnalyticsQueryKey: () => readonly ["/api/intelligence-dataset/analytics"];
export declare const getGetIntelligenceAnalyticsQueryOptions: <TData = Awaited<ReturnType<typeof getIntelligenceAnalytics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceAnalytics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceAnalytics>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntelligenceAnalyticsQueryResult = NonNullable<Awaited<ReturnType<typeof getIntelligenceAnalytics>>>;
export type GetIntelligenceAnalyticsQueryError = ErrorType<unknown>;
/**
 * @summary Per-company intelligence dataset analytics
 */
export declare function useGetIntelligenceAnalytics<TData = Awaited<ReturnType<typeof getIntelligenceAnalytics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceAnalytics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListIntelligenceRecordsUrl: (params?: ListIntelligenceRecordsParams) => string;
/**
 * @summary List intelligence records for the caller's company
 */
export declare const listIntelligenceRecords: (params?: ListIntelligenceRecordsParams, options?: RequestInit) => Promise<IntelligenceRecordPage>;
export declare const getListIntelligenceRecordsQueryKey: (params?: ListIntelligenceRecordsParams) => readonly ["/api/intelligence-dataset/records", ...ListIntelligenceRecordsParams[]];
export declare const getListIntelligenceRecordsQueryOptions: <TData = Awaited<ReturnType<typeof listIntelligenceRecords>>, TError = ErrorType<unknown>>(params?: ListIntelligenceRecordsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceRecords>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceRecords>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListIntelligenceRecordsQueryResult = NonNullable<Awaited<ReturnType<typeof listIntelligenceRecords>>>;
export type ListIntelligenceRecordsQueryError = ErrorType<unknown>;
/**
 * @summary List intelligence records for the caller's company
 */
export declare function useListIntelligenceRecords<TData = Awaited<ReturnType<typeof listIntelligenceRecords>>, TError = ErrorType<unknown>>(params?: ListIntelligenceRecordsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listIntelligenceRecords>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateIntelligenceRecordUrl: () => string;
/**
 * @summary Create a record from an uploaded image (runs the AI suggestion)
 */
export declare const createIntelligenceRecord: (intelligenceRecordInput: IntelligenceRecordInput, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getCreateIntelligenceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createIntelligenceRecord>>, TError, {
        data: BodyType<IntelligenceRecordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createIntelligenceRecord>>, TError, {
    data: BodyType<IntelligenceRecordInput>;
}, TContext>;
export type CreateIntelligenceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof createIntelligenceRecord>>>;
export type CreateIntelligenceRecordMutationBody = BodyType<IntelligenceRecordInput>;
export type CreateIntelligenceRecordMutationError = ErrorType<unknown>;
/**
* @summary Create a record from an uploaded image (runs the AI suggestion)
*/
export declare const useCreateIntelligenceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createIntelligenceRecord>>, TError, {
        data: BodyType<IntelligenceRecordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createIntelligenceRecord>>, TError, {
    data: BodyType<IntelligenceRecordInput>;
}, TContext>;
export declare const getGetIntelligenceRecordUrl: (id: number) => string;
/**
 * @summary Get a single intelligence record
 */
export declare const getIntelligenceRecord: (id: number, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getGetIntelligenceRecordQueryKey: (id: number) => readonly [`/api/intelligence-dataset/records/${number}`];
export declare const getGetIntelligenceRecordQueryOptions: <TData = Awaited<ReturnType<typeof getIntelligenceRecord>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceRecord>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceRecord>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntelligenceRecordQueryResult = NonNullable<Awaited<ReturnType<typeof getIntelligenceRecord>>>;
export type GetIntelligenceRecordQueryError = ErrorType<unknown>;
/**
 * @summary Get a single intelligence record
 */
export declare function useGetIntelligenceRecord<TData = Awaited<ReturnType<typeof getIntelligenceRecord>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntelligenceRecord>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getConfirmIntelligenceRecordUrl: (id: number) => string;
/**
 * @summary Technician confirms/corrects the AI suggestion + adds detail
 */
export declare const confirmIntelligenceRecord: (id: number, intelligenceConfirmInput: IntelligenceConfirmInput, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getConfirmIntelligenceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceConfirmInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof confirmIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceConfirmInput>;
}, TContext>;
export type ConfirmIntelligenceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof confirmIntelligenceRecord>>>;
export type ConfirmIntelligenceRecordMutationBody = BodyType<IntelligenceConfirmInput>;
export type ConfirmIntelligenceRecordMutationError = ErrorType<unknown>;
/**
* @summary Technician confirms/corrects the AI suggestion + adds detail
*/
export declare const useConfirmIntelligenceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceConfirmInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof confirmIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceConfirmInput>;
}, TContext>;
export declare const getSkipIntelligenceRecordUrl: (id: number) => string;
/**
 * @summary Skip a record (retained, excluded from the dataset)
 */
export declare const skipIntelligenceRecord: (id: number, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getSkipIntelligenceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof skipIntelligenceRecord>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof skipIntelligenceRecord>>, TError, {
    id: number;
}, TContext>;
export type SkipIntelligenceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof skipIntelligenceRecord>>>;
export type SkipIntelligenceRecordMutationError = ErrorType<unknown>;
/**
* @summary Skip a record (retained, excluded from the dataset)
*/
export declare const useSkipIntelligenceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof skipIntelligenceRecord>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof skipIntelligenceRecord>>, TError, {
    id: number;
}, TContext>;
export declare const getVoteIntelligenceRecordUrl: (id: number) => string;
/**
 * @summary Cast a confirm/dispute vote (drives multi-technician verification)
 */
export declare const voteIntelligenceRecord: (id: number, intelligenceVoteInput: IntelligenceVoteInput, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getVoteIntelligenceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof voteIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceVoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof voteIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceVoteInput>;
}, TContext>;
export type VoteIntelligenceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof voteIntelligenceRecord>>>;
export type VoteIntelligenceRecordMutationBody = BodyType<IntelligenceVoteInput>;
export type VoteIntelligenceRecordMutationError = ErrorType<unknown>;
/**
* @summary Cast a confirm/dispute vote (drives multi-technician verification)
*/
export declare const useVoteIntelligenceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof voteIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceVoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof voteIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceVoteInput>;
}, TContext>;
export declare const getReviewIntelligenceRecordUrl: (id: number) => string;
/**
 * @summary Manager review — approve / reject / edit / expert-verify
 */
export declare const reviewIntelligenceRecord: (id: number, intelligenceReviewInput: IntelligenceReviewInput, options?: RequestInit) => Promise<IntelligenceRecord>;
export declare const getReviewIntelligenceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceReviewInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reviewIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceReviewInput>;
}, TContext>;
export type ReviewIntelligenceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof reviewIntelligenceRecord>>>;
export type ReviewIntelligenceRecordMutationBody = BodyType<IntelligenceReviewInput>;
export type ReviewIntelligenceRecordMutationError = ErrorType<unknown>;
/**
* @summary Manager review — approve / reject / edit / expert-verify
*/
export declare const useReviewIntelligenceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewIntelligenceRecord>>, TError, {
        id: number;
        data: BodyType<IntelligenceReviewInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reviewIntelligenceRecord>>, TError, {
    id: number;
    data: BodyType<IntelligenceReviewInput>;
}, TContext>;
export declare const getListReportsUrl: () => string;
/**
 * @summary List generated reports
 */
export declare const listReports: (options?: RequestInit) => Promise<Report[]>;
export declare const getListReportsQueryKey: () => readonly ["/api/reports"];
export declare const getListReportsQueryOptions: <TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportsQueryResult = NonNullable<Awaited<ReturnType<typeof listReports>>>;
export type ListReportsQueryError = ErrorType<unknown>;
/**
 * @summary List generated reports
 */
export declare function useListReports<TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGenerateReportUrl: () => string;
/**
 * @summary Generate a new report
 */
export declare const generateReport: (reportInput: ReportInput, options?: RequestInit) => Promise<Report>;
export declare const getGenerateReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateReport>>, TError, {
        data: BodyType<ReportInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateReport>>, TError, {
    data: BodyType<ReportInput>;
}, TContext>;
export type GenerateReportMutationResult = NonNullable<Awaited<ReturnType<typeof generateReport>>>;
export type GenerateReportMutationBody = BodyType<ReportInput>;
export type GenerateReportMutationError = ErrorType<unknown>;
/**
* @summary Generate a new report
*/
export declare const useGenerateReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateReport>>, TError, {
        data: BodyType<ReportInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateReport>>, TError, {
    data: BodyType<ReportInput>;
}, TContext>;
export declare const getGetReportUrl: (id: number) => string;
/**
 * @summary Get report by ID
 */
export declare const getReport: (id: number, options?: RequestInit) => Promise<Report>;
export declare const getGetReportQueryKey: (id: number) => readonly [`/api/reports/${number}`];
export declare const getGetReportQueryOptions: <TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportQueryResult = NonNullable<Awaited<ReturnType<typeof getReport>>>;
export type GetReportQueryError = ErrorType<unknown>;
/**
 * @summary Get report by ID
 */
export declare function useGetReport<TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDeleteReportUrl: (id: number) => string;
/**
 * @summary Delete report
 */
export declare const deleteReport: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
    id: number;
}, TContext>;
export type DeleteReportMutationResult = NonNullable<Awaited<ReturnType<typeof deleteReport>>>;
export type DeleteReportMutationError = ErrorType<unknown>;
/**
* @summary Delete report
*/
export declare const useDeleteReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteReport>>, TError, {
    id: number;
}, TContext>;
export declare const getGenerateReportNarrativeUrl: (id: number) => string;
/**
 * @summary Generate or regenerate the AI narrative report
 */
export declare const generateReportNarrative: (id: number, generateNarrativeInput?: GenerateNarrativeInput, options?: RequestInit) => Promise<Report>;
export declare const getGenerateReportNarrativeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateReportNarrative>>, TError, {
        id: number;
        data?: BodyType<GenerateNarrativeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateReportNarrative>>, TError, {
    id: number;
    data?: BodyType<GenerateNarrativeInput>;
}, TContext>;
export type GenerateReportNarrativeMutationResult = NonNullable<Awaited<ReturnType<typeof generateReportNarrative>>>;
export type GenerateReportNarrativeMutationBody = BodyType<GenerateNarrativeInput> | undefined;
export type GenerateReportNarrativeMutationError = ErrorType<unknown>;
/**
* @summary Generate or regenerate the AI narrative report
*/
export declare const useGenerateReportNarrative: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateReportNarrative>>, TError, {
        id: number;
        data?: BodyType<GenerateNarrativeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateReportNarrative>>, TError, {
    id: number;
    data?: BodyType<GenerateNarrativeInput>;
}, TContext>;
export declare const getGetAnalyticsDashboardUrl: () => string;
/**
 * @summary Get full analytics dashboard data
 */
export declare const getAnalyticsDashboard: (options?: RequestInit) => Promise<AnalyticsDashboard>;
export declare const getGetAnalyticsDashboardQueryKey: () => readonly ["/api/analytics/dashboard"];
export declare const getGetAnalyticsDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getAnalyticsDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAnalyticsDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getAnalyticsDashboard>>>;
export type GetAnalyticsDashboardQueryError = ErrorType<unknown>;
/**
 * @summary Get full analytics dashboard data
 */
export declare function useGetAnalyticsDashboard<TData = Awaited<ReturnType<typeof getAnalyticsDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAnalyticsTrendsUrl: (params?: GetAnalyticsTrendsParams) => string;
/**
 * @summary Get findings trends over time
 */
export declare const getAnalyticsTrends: (params?: GetAnalyticsTrendsParams, options?: RequestInit) => Promise<TrendDataPoint[]>;
export declare const getGetAnalyticsTrendsQueryKey: (params?: GetAnalyticsTrendsParams) => readonly ["/api/analytics/trends", ...GetAnalyticsTrendsParams[]];
export declare const getGetAnalyticsTrendsQueryOptions: <TData = Awaited<ReturnType<typeof getAnalyticsTrends>>, TError = ErrorType<unknown>>(params?: GetAnalyticsTrendsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsTrends>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsTrends>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAnalyticsTrendsQueryResult = NonNullable<Awaited<ReturnType<typeof getAnalyticsTrends>>>;
export type GetAnalyticsTrendsQueryError = ErrorType<unknown>;
/**
 * @summary Get findings trends over time
 */
export declare function useGetAnalyticsTrends<TData = Awaited<ReturnType<typeof getAnalyticsTrends>>, TError = ErrorType<unknown>>(params?: GetAnalyticsTrendsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAnalyticsTrends>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTechnicianPerformanceUrl: () => string;
/**
 * @summary Get technician performance metrics
 */
export declare const getTechnicianPerformance: (options?: RequestInit) => Promise<TechnicianPerformance[]>;
export declare const getGetTechnicianPerformanceQueryKey: () => readonly ["/api/analytics/technicians"];
export declare const getGetTechnicianPerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getTechnicianPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTechnicianPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTechnicianPerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTechnicianPerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getTechnicianPerformance>>>;
export type GetTechnicianPerformanceQueryError = ErrorType<unknown>;
/**
 * @summary Get technician performance metrics
 */
export declare function useGetTechnicianPerformance<TData = Awaited<ReturnType<typeof getTechnicianPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTechnicianPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetInfestationRiskUrl: () => string;
/**
 * @summary Get infestation risk assessment
 */
export declare const getInfestationRisk: (options?: RequestInit) => Promise<InfestationRisk>;
export declare const getGetInfestationRiskQueryKey: () => readonly ["/api/analytics/risk"];
export declare const getGetInfestationRiskQueryOptions: <TData = Awaited<ReturnType<typeof getInfestationRisk>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInfestationRisk>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getInfestationRisk>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetInfestationRiskQueryResult = NonNullable<Awaited<ReturnType<typeof getInfestationRisk>>>;
export type GetInfestationRiskQueryError = ErrorType<unknown>;
/**
 * @summary Get infestation risk assessment
 */
export declare function useGetInfestationRisk<TData = Awaited<ReturnType<typeof getInfestationRisk>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInfestationRisk>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOpportunityIntelligenceUrl: () => string;
/**
 * @summary Get evidence-based opportunity intelligence
 */
export declare const getOpportunityIntelligence: (options?: RequestInit) => Promise<OpportunityIntelligence>;
export declare const getGetOpportunityIntelligenceQueryKey: () => readonly ["/api/intelligence/opportunities"];
export declare const getGetOpportunityIntelligenceQueryOptions: <TData = Awaited<ReturnType<typeof getOpportunityIntelligence>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunityIntelligence>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOpportunityIntelligence>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOpportunityIntelligenceQueryResult = NonNullable<Awaited<ReturnType<typeof getOpportunityIntelligence>>>;
export type GetOpportunityIntelligenceQueryError = ErrorType<unknown>;
/**
 * @summary Get evidence-based opportunity intelligence
 */
export declare function useGetOpportunityIntelligence<TData = Awaited<ReturnType<typeof getOpportunityIntelligence>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunityIntelligence>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCallbackIntelligenceUrl: () => string;
/**
 * @summary Get callback intelligence (chains and patterns)
 */
export declare const getCallbackIntelligence: (options?: RequestInit) => Promise<CallbackIntelligence>;
export declare const getGetCallbackIntelligenceQueryKey: () => readonly ["/api/intelligence/callbacks"];
export declare const getGetCallbackIntelligenceQueryOptions: <TData = Awaited<ReturnType<typeof getCallbackIntelligence>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCallbackIntelligence>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCallbackIntelligence>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCallbackIntelligenceQueryResult = NonNullable<Awaited<ReturnType<typeof getCallbackIntelligence>>>;
export type GetCallbackIntelligenceQueryError = ErrorType<unknown>;
/**
 * @summary Get callback intelligence (chains and patterns)
 */
export declare function useGetCallbackIntelligence<TData = Awaited<ReturnType<typeof getCallbackIntelligence>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCallbackIntelligence>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPropertyRiskInsightsUrl: () => string;
/**
 * @summary Get property risk insights
 */
export declare const getPropertyRiskInsights: (options?: RequestInit) => Promise<PropertyRiskInsights>;
export declare const getGetPropertyRiskInsightsQueryKey: () => readonly ["/api/intelligence/property-risk"];
export declare const getGetPropertyRiskInsightsQueryOptions: <TData = Awaited<ReturnType<typeof getPropertyRiskInsights>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPropertyRiskInsights>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPropertyRiskInsights>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPropertyRiskInsightsQueryResult = NonNullable<Awaited<ReturnType<typeof getPropertyRiskInsights>>>;
export type GetPropertyRiskInsightsQueryError = ErrorType<unknown>;
/**
 * @summary Get property risk insights
 */
export declare function useGetPropertyRiskInsights<TData = Awaited<ReturnType<typeof getPropertyRiskInsights>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPropertyRiskInsights>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetBrandingUrl: () => string;
/**
 * @summary Get the active white-label branding profile (public)
 */
export declare const getBranding: (options?: RequestInit) => Promise<BrandingProfile>;
export declare const getGetBrandingQueryKey: () => readonly ["/api/branding"];
export declare const getGetBrandingQueryOptions: <TData = Awaited<ReturnType<typeof getBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBranding>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBrandingQueryResult = NonNullable<Awaited<ReturnType<typeof getBranding>>>;
export type GetBrandingQueryError = ErrorType<unknown>;
/**
 * @summary Get the active white-label branding profile (public)
 */
export declare function useGetBranding<TData = Awaited<ReturnType<typeof getBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetActiveBrandingUrl: () => string;
/**
 * @summary Get the active white-label branding profile (public)
 */
export declare const getActiveBranding: (options?: RequestInit) => Promise<BrandingProfile>;
export declare const getGetActiveBrandingQueryKey: () => readonly ["/api/branding/active"];
export declare const getGetActiveBrandingQueryOptions: <TData = Awaited<ReturnType<typeof getActiveBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getActiveBranding>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetActiveBrandingQueryResult = NonNullable<Awaited<ReturnType<typeof getActiveBranding>>>;
export type GetActiveBrandingQueryError = ErrorType<unknown>;
/**
 * @summary Get the active white-label branding profile (public)
 */
export declare function useGetActiveBranding<TData = Awaited<ReturnType<typeof getActiveBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCompanyBrandingUrl: () => string;
/**
 * @summary Get the caller company's active branding profile (authenticated)
 */
export declare const getCompanyBranding: (options?: RequestInit) => Promise<BrandingProfile>;
export declare const getGetCompanyBrandingQueryKey: () => readonly ["/api/branding/company"];
export declare const getGetCompanyBrandingQueryOptions: <TData = Awaited<ReturnType<typeof getCompanyBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCompanyBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCompanyBranding>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCompanyBrandingQueryResult = NonNullable<Awaited<ReturnType<typeof getCompanyBranding>>>;
export type GetCompanyBrandingQueryError = ErrorType<unknown>;
/**
 * @summary Get the caller company's active branding profile (authenticated)
 */
export declare function useGetCompanyBranding<TData = Awaited<ReturnType<typeof getCompanyBranding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCompanyBranding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListBrandingProfilesUrl: () => string;
/**
 * @summary List all branding profiles (manager only)
 */
export declare const listBrandingProfiles: (options?: RequestInit) => Promise<BrandingProfile[]>;
export declare const getListBrandingProfilesQueryKey: () => readonly ["/api/branding/profiles"];
export declare const getListBrandingProfilesQueryOptions: <TData = Awaited<ReturnType<typeof listBrandingProfiles>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBrandingProfiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listBrandingProfiles>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListBrandingProfilesQueryResult = NonNullable<Awaited<ReturnType<typeof listBrandingProfiles>>>;
export type ListBrandingProfilesQueryError = ErrorType<unknown>;
/**
 * @summary List all branding profiles (manager only)
 */
export declare function useListBrandingProfiles<TData = Awaited<ReturnType<typeof listBrandingProfiles>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBrandingProfiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateBrandingProfileUrl: () => string;
/**
 * @summary Create a branding profile (manager only)
 */
export declare const createBrandingProfile: (brandingProfileInput: BrandingProfileInput, options?: RequestInit) => Promise<BrandingProfile>;
export declare const getCreateBrandingProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBrandingProfile>>, TError, {
        data: BodyType<BrandingProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBrandingProfile>>, TError, {
    data: BodyType<BrandingProfileInput>;
}, TContext>;
export type CreateBrandingProfileMutationResult = NonNullable<Awaited<ReturnType<typeof createBrandingProfile>>>;
export type CreateBrandingProfileMutationBody = BodyType<BrandingProfileInput>;
export type CreateBrandingProfileMutationError = ErrorType<unknown>;
/**
* @summary Create a branding profile (manager only)
*/
export declare const useCreateBrandingProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBrandingProfile>>, TError, {
        data: BodyType<BrandingProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBrandingProfile>>, TError, {
    data: BodyType<BrandingProfileInput>;
}, TContext>;
export declare const getGetBrandingProfileUrl: (id: number) => string;
/**
 * @summary Get a branding profile (manager only)
 */
export declare const getBrandingProfile: (id: number, options?: RequestInit) => Promise<BrandingProfile>;
export declare const getGetBrandingProfileQueryKey: (id: number) => readonly [`/api/branding/profiles/${number}`];
export declare const getGetBrandingProfileQueryOptions: <TData = Awaited<ReturnType<typeof getBrandingProfile>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBrandingProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBrandingProfile>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBrandingProfileQueryResult = NonNullable<Awaited<ReturnType<typeof getBrandingProfile>>>;
export type GetBrandingProfileQueryError = ErrorType<unknown>;
/**
 * @summary Get a branding profile (manager only)
 */
export declare function useGetBrandingProfile<TData = Awaited<ReturnType<typeof getBrandingProfile>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBrandingProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateBrandingProfileUrl: (id: number) => string;
/**
 * @summary Update a branding profile (manager only)
 */
export declare const updateBrandingProfile: (id: number, brandingProfileInput: BrandingProfileInput, options?: RequestInit) => Promise<BrandingProfile>;
export declare const getUpdateBrandingProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateBrandingProfile>>, TError, {
        id: number;
        data: BodyType<BrandingProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateBrandingProfile>>, TError, {
    id: number;
    data: BodyType<BrandingProfileInput>;
}, TContext>;
export type UpdateBrandingProfileMutationResult = NonNullable<Awaited<ReturnType<typeof updateBrandingProfile>>>;
export type UpdateBrandingProfileMutationBody = BodyType<BrandingProfileInput>;
export type UpdateBrandingProfileMutationError = ErrorType<unknown>;
/**
* @summary Update a branding profile (manager only)
*/
export declare const useUpdateBrandingProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateBrandingProfile>>, TError, {
        id: number;
        data: BodyType<BrandingProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateBrandingProfile>>, TError, {
    id: number;
    data: BodyType<BrandingProfileInput>;
}, TContext>;
export declare const getDeleteBrandingProfileUrl: (id: number) => string;
/**
 * @summary Delete a branding profile (manager only)
 */
export declare const deleteBrandingProfile: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteBrandingProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export type DeleteBrandingProfileMutationResult = NonNullable<Awaited<ReturnType<typeof deleteBrandingProfile>>>;
export type DeleteBrandingProfileMutationError = ErrorType<unknown>;
/**
* @summary Delete a branding profile (manager only)
*/
export declare const useDeleteBrandingProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export declare const getDuplicateBrandingProfileUrl: (id: number) => string;
/**
 * @summary Duplicate a branding profile (manager only)
 */
export declare const duplicateBrandingProfile: (id: number, options?: RequestInit) => Promise<BrandingProfile>;
export declare const getDuplicateBrandingProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof duplicateBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof duplicateBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export type DuplicateBrandingProfileMutationResult = NonNullable<Awaited<ReturnType<typeof duplicateBrandingProfile>>>;
export type DuplicateBrandingProfileMutationError = ErrorType<unknown>;
/**
* @summary Duplicate a branding profile (manager only)
*/
export declare const useDuplicateBrandingProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof duplicateBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof duplicateBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export declare const getActivateBrandingProfileUrl: (id: number) => string;
/**
 * @summary Set a branding profile as active (manager only)
 */
export declare const activateBrandingProfile: (id: number, options?: RequestInit) => Promise<BrandingProfile>;
export declare const getActivateBrandingProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof activateBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export type ActivateBrandingProfileMutationResult = NonNullable<Awaited<ReturnType<typeof activateBrandingProfile>>>;
export type ActivateBrandingProfileMutationError = ErrorType<unknown>;
/**
* @summary Set a branding profile as active (manager only)
*/
export declare const useActivateBrandingProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateBrandingProfile>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof activateBrandingProfile>>, TError, {
    id: number;
}, TContext>;
export declare const getRestoreBrandingDefaultsUrl: () => string;
/**
 * @summary Reset the default profile to ReadyLoq defaults and activate it (manager only)
 */
export declare const restoreBrandingDefaults: (options?: RequestInit) => Promise<BrandingProfile>;
export declare const getRestoreBrandingDefaultsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof restoreBrandingDefaults>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof restoreBrandingDefaults>>, TError, void, TContext>;
export type RestoreBrandingDefaultsMutationResult = NonNullable<Awaited<ReturnType<typeof restoreBrandingDefaults>>>;
export type RestoreBrandingDefaultsMutationError = ErrorType<unknown>;
/**
* @summary Reset the default profile to ReadyLoq defaults and activate it (manager only)
*/
export declare const useRestoreBrandingDefaults: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof restoreBrandingDefaults>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof restoreBrandingDefaults>>, TError, void, TContext>;
export declare const getListPropertiesUrl: () => string;
/**
 * @summary List all known properties with an intelligence summary
 */
export declare const listProperties: (options?: RequestInit) => Promise<PropertySummary[]>;
export declare const getListPropertiesQueryKey: () => readonly ["/api/properties"];
export declare const getListPropertiesQueryOptions: <TData = Awaited<ReturnType<typeof listProperties>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProperties>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProperties>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPropertiesQueryResult = NonNullable<Awaited<ReturnType<typeof listProperties>>>;
export type ListPropertiesQueryError = ErrorType<unknown>;
/**
 * @summary List all known properties with an intelligence summary
 */
export declare function useListProperties<TData = Awaited<ReturnType<typeof listProperties>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProperties>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLookupPropertyUrl: (params: LookupPropertyParams) => string;
/**
 * @summary Look up property intelligence by free-text site address (pre-inspection)
 */
export declare const lookupProperty: (params: LookupPropertyParams, options?: RequestInit) => Promise<PropertyLookupResult>;
export declare const getLookupPropertyQueryKey: (params?: LookupPropertyParams) => readonly ["/api/properties/lookup", ...LookupPropertyParams[]];
export declare const getLookupPropertyQueryOptions: <TData = Awaited<ReturnType<typeof lookupProperty>>, TError = ErrorType<unknown>>(params: LookupPropertyParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof lookupProperty>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof lookupProperty>>, TError, TData> & {
    queryKey: QueryKey;
};
export type LookupPropertyQueryResult = NonNullable<Awaited<ReturnType<typeof lookupProperty>>>;
export type LookupPropertyQueryError = ErrorType<unknown>;
/**
 * @summary Look up property intelligence by free-text site address (pre-inspection)
 */
export declare function useLookupProperty<TData = Awaited<ReturnType<typeof lookupProperty>>, TError = ErrorType<unknown>>(params: LookupPropertyParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof lookupProperty>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPropertyFeedUrl: (addressKey: string) => string;
/**
 * @summary Get the full intelligence feed for a property
 */
export declare const getPropertyFeed: (addressKey: string, options?: RequestInit) => Promise<PropertyFeed>;
export declare const getGetPropertyFeedQueryKey: (addressKey: string) => readonly [`/api/properties/${string}`];
export declare const getGetPropertyFeedQueryOptions: <TData = Awaited<ReturnType<typeof getPropertyFeed>>, TError = ErrorType<unknown>>(addressKey: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPropertyFeed>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPropertyFeed>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPropertyFeedQueryResult = NonNullable<Awaited<ReturnType<typeof getPropertyFeed>>>;
export type GetPropertyFeedQueryError = ErrorType<unknown>;
/**
 * @summary Get the full intelligence feed for a property
 */
export declare function useGetPropertyFeed<TData = Awaited<ReturnType<typeof getPropertyFeed>>, TError = ErrorType<unknown>>(addressKey: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPropertyFeed>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdatePropertyProfileUrl: (addressKey: string) => string;
/**
 * @summary Create or update the authored intelligence for a property
 */
export declare const updatePropertyProfile: (addressKey: string, propertyProfileUpdate: PropertyProfileUpdate, options?: RequestInit) => Promise<PropertyFeed>;
export declare const getUpdatePropertyProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePropertyProfile>>, TError, {
        addressKey: string;
        data: BodyType<PropertyProfileUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePropertyProfile>>, TError, {
    addressKey: string;
    data: BodyType<PropertyProfileUpdate>;
}, TContext>;
export type UpdatePropertyProfileMutationResult = NonNullable<Awaited<ReturnType<typeof updatePropertyProfile>>>;
export type UpdatePropertyProfileMutationBody = BodyType<PropertyProfileUpdate>;
export type UpdatePropertyProfileMutationError = ErrorType<unknown>;
/**
* @summary Create or update the authored intelligence for a property
*/
export declare const useUpdatePropertyProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePropertyProfile>>, TError, {
        addressKey: string;
        data: BodyType<PropertyProfileUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePropertyProfile>>, TError, {
    addressKey: string;
    data: BodyType<PropertyProfileUpdate>;
}, TContext>;
export declare const getAddPropertyNoteUrl: (addressKey: string) => string;
/**
 * @summary Append a field note to a property
 */
export declare const addPropertyNote: (addressKey: string, propertyNoteInput: PropertyNoteInput, options?: RequestInit) => Promise<PropertyNote>;
export declare const getAddPropertyNoteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPropertyNote>>, TError, {
        addressKey: string;
        data: BodyType<PropertyNoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addPropertyNote>>, TError, {
    addressKey: string;
    data: BodyType<PropertyNoteInput>;
}, TContext>;
export type AddPropertyNoteMutationResult = NonNullable<Awaited<ReturnType<typeof addPropertyNote>>>;
export type AddPropertyNoteMutationBody = BodyType<PropertyNoteInput>;
export type AddPropertyNoteMutationError = ErrorType<unknown>;
/**
* @summary Append a field note to a property
*/
export declare const useAddPropertyNote: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPropertyNote>>, TError, {
        addressKey: string;
        data: BodyType<PropertyNoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addPropertyNote>>, TError, {
    addressKey: string;
    data: BodyType<PropertyNoteInput>;
}, TContext>;
export declare const getCreateLeadUrl: () => string;
/**
 * @summary Capture a marketing-site lead (demo request or contact inquiry)
 */
export declare const createLead: (leadInput: LeadInput, options?: RequestInit) => Promise<Lead>;
export declare const getCreateLeadMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLead>>, TError, {
        data: BodyType<LeadInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createLead>>, TError, {
    data: BodyType<LeadInput>;
}, TContext>;
export type CreateLeadMutationResult = NonNullable<Awaited<ReturnType<typeof createLead>>>;
export type CreateLeadMutationBody = BodyType<LeadInput>;
export type CreateLeadMutationError = ErrorType<Error>;
/**
* @summary Capture a marketing-site lead (demo request or contact inquiry)
*/
export declare const useCreateLead: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLead>>, TError, {
        data: BodyType<LeadInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createLead>>, TError, {
    data: BodyType<LeadInput>;
}, TContext>;
export declare const getSubmitFeedbackUrl: () => string;
/**
 * @summary Submit beta feedback (any company member)
 */
export declare const submitFeedback: (submitFeedbackInput: SubmitFeedbackInput, options?: RequestInit) => Promise<BetaFeedback>;
export declare const getSubmitFeedbackMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
        data: BodyType<SubmitFeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
    data: BodyType<SubmitFeedbackInput>;
}, TContext>;
export type SubmitFeedbackMutationResult = NonNullable<Awaited<ReturnType<typeof submitFeedback>>>;
export type SubmitFeedbackMutationBody = BodyType<SubmitFeedbackInput>;
export type SubmitFeedbackMutationError = ErrorType<Error>;
/**
* @summary Submit beta feedback (any company member)
*/
export declare const useSubmitFeedback: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
        data: BodyType<SubmitFeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof submitFeedback>>, TError, {
    data: BodyType<SubmitFeedbackInput>;
}, TContext>;
export declare const getListFeedbackUrl: (params?: ListFeedbackParams) => string;
/**
 * @summary List beta feedback (manager+)
 */
export declare const listFeedback: (params?: ListFeedbackParams, options?: RequestInit) => Promise<BetaFeedback[]>;
export declare const getListFeedbackQueryKey: (params?: ListFeedbackParams) => readonly ["/api/beta/feedback", ...ListFeedbackParams[]];
export declare const getListFeedbackQueryOptions: <TData = Awaited<ReturnType<typeof listFeedback>>, TError = ErrorType<unknown>>(params?: ListFeedbackParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFeedback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listFeedback>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListFeedbackQueryResult = NonNullable<Awaited<ReturnType<typeof listFeedback>>>;
export type ListFeedbackQueryError = ErrorType<unknown>;
/**
 * @summary List beta feedback (manager+)
 */
export declare function useListFeedback<TData = Awaited<ReturnType<typeof listFeedback>>, TError = ErrorType<unknown>>(params?: ListFeedbackParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFeedback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateFeedbackUrl: (id: number) => string;
/**
 * @summary Update feedback status/severity (manager+)
 */
export declare const updateFeedback: (id: number, updateFeedbackInput: UpdateFeedbackInput, options?: RequestInit) => Promise<BetaFeedback>;
export declare const getUpdateFeedbackMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFeedback>>, TError, {
        id: number;
        data: BodyType<UpdateFeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateFeedback>>, TError, {
    id: number;
    data: BodyType<UpdateFeedbackInput>;
}, TContext>;
export type UpdateFeedbackMutationResult = NonNullable<Awaited<ReturnType<typeof updateFeedback>>>;
export type UpdateFeedbackMutationBody = BodyType<UpdateFeedbackInput>;
export type UpdateFeedbackMutationError = ErrorType<unknown>;
/**
* @summary Update feedback status/severity (manager+)
*/
export declare const useUpdateFeedback: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFeedback>>, TError, {
        id: number;
        data: BodyType<UpdateFeedbackInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateFeedback>>, TError, {
    id: number;
    data: BodyType<UpdateFeedbackInput>;
}, TContext>;
export declare const getReportClientErrorUrl: () => string;
/**
 * @summary Report a client-side failure (any company member)
 */
export declare const reportClientError: (clientErrorInput: ClientErrorInput, options?: RequestInit) => Promise<OkResponse>;
export declare const getReportClientErrorMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reportClientError>>, TError, {
        data: BodyType<ClientErrorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reportClientError>>, TError, {
    data: BodyType<ClientErrorInput>;
}, TContext>;
export type ReportClientErrorMutationResult = NonNullable<Awaited<ReturnType<typeof reportClientError>>>;
export type ReportClientErrorMutationBody = BodyType<ClientErrorInput>;
export type ReportClientErrorMutationError = ErrorType<unknown>;
/**
* @summary Report a client-side failure (any company member)
*/
export declare const useReportClientError: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reportClientError>>, TError, {
        data: BodyType<ClientErrorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reportClientError>>, TError, {
    data: BodyType<ClientErrorInput>;
}, TContext>;
export declare const getListErrorEventsUrl: () => string;
/**
 * @summary List error events with summary (manager+)
 */
export declare const listErrorEvents: (options?: RequestInit) => Promise<ErrorEventList>;
export declare const getListErrorEventsQueryKey: () => readonly ["/api/beta/errors"];
export declare const getListErrorEventsQueryOptions: <TData = Awaited<ReturnType<typeof listErrorEvents>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listErrorEvents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listErrorEvents>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListErrorEventsQueryResult = NonNullable<Awaited<ReturnType<typeof listErrorEvents>>>;
export type ListErrorEventsQueryError = ErrorType<unknown>;
/**
 * @summary List error events with summary (manager+)
 */
export declare function useListErrorEvents<TData = Awaited<ReturnType<typeof listErrorEvents>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listErrorEvents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetChecklistUrl: () => string;
/**
 * @summary Get the closed-beta checklist with company state (manager+)
 */
export declare const getChecklist: (options?: RequestInit) => Promise<ChecklistResponse>;
export declare const getGetChecklistQueryKey: () => readonly ["/api/beta/checklist"];
export declare const getGetChecklistQueryOptions: <TData = Awaited<ReturnType<typeof getChecklist>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getChecklist>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getChecklist>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetChecklistQueryResult = NonNullable<Awaited<ReturnType<typeof getChecklist>>>;
export type GetChecklistQueryError = ErrorType<unknown>;
/**
 * @summary Get the closed-beta checklist with company state (manager+)
 */
export declare function useGetChecklist<TData = Awaited<ReturnType<typeof getChecklist>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getChecklist>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getToggleChecklistItemUrl: (itemKey: string) => string;
/**
 * @summary Toggle a checklist item (manager+)
 */
export declare const toggleChecklistItem: (itemKey: string, toggleChecklistInput: ToggleChecklistInput, options?: RequestInit) => Promise<ChecklistToggleResult>;
export declare const getToggleChecklistItemMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof toggleChecklistItem>>, TError, {
        itemKey: string;
        data: BodyType<ToggleChecklistInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof toggleChecklistItem>>, TError, {
    itemKey: string;
    data: BodyType<ToggleChecklistInput>;
}, TContext>;
export type ToggleChecklistItemMutationResult = NonNullable<Awaited<ReturnType<typeof toggleChecklistItem>>>;
export type ToggleChecklistItemMutationBody = BodyType<ToggleChecklistInput>;
export type ToggleChecklistItemMutationError = ErrorType<unknown>;
/**
* @summary Toggle a checklist item (manager+)
*/
export declare const useToggleChecklistItem: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof toggleChecklistItem>>, TError, {
        itemKey: string;
        data: BodyType<ToggleChecklistInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof toggleChecklistItem>>, TError, {
    itemKey: string;
    data: BodyType<ToggleChecklistInput>;
}, TContext>;
export declare const getListTestersUrl: () => string;
/**
 * @summary List beta testers with activity (manager+)
 */
export declare const listTesters: (options?: RequestInit) => Promise<Tester[]>;
export declare const getListTestersQueryKey: () => readonly ["/api/beta/testers"];
export declare const getListTestersQueryOptions: <TData = Awaited<ReturnType<typeof listTesters>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTesters>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listTesters>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListTestersQueryResult = NonNullable<Awaited<ReturnType<typeof listTesters>>>;
export type ListTestersQueryError = ErrorType<unknown>;
/**
 * @summary List beta testers with activity (manager+)
 */
export declare function useListTesters<TData = Awaited<ReturnType<typeof listTesters>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTesters>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateTesterAccessUrl: (userId: number) => string;
/**
 * @summary Pause or restore a technician's beta access (manager+)
 */
export declare const updateTesterAccess: (userId: number, toggleAccessInput: ToggleAccessInput, options?: RequestInit) => Promise<TesterAccessResult>;
export declare const getUpdateTesterAccessMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTesterAccess>>, TError, {
        userId: number;
        data: BodyType<ToggleAccessInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateTesterAccess>>, TError, {
    userId: number;
    data: BodyType<ToggleAccessInput>;
}, TContext>;
export type UpdateTesterAccessMutationResult = NonNullable<Awaited<ReturnType<typeof updateTesterAccess>>>;
export type UpdateTesterAccessMutationBody = BodyType<ToggleAccessInput>;
export type UpdateTesterAccessMutationError = ErrorType<unknown>;
/**
* @summary Pause or restore a technician's beta access (manager+)
*/
export declare const useUpdateTesterAccess: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTesterAccess>>, TError, {
        userId: number;
        data: BodyType<ToggleAccessInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateTesterAccess>>, TError, {
    userId: number;
    data: BodyType<ToggleAccessInput>;
}, TContext>;
export declare const getCreateInviteUrl: () => string;
/**
 * @summary Create a company invite (manager+)
 */
export declare const createInvite: (createInviteInput: CreateInviteInput, options?: RequestInit) => Promise<Invite>;
export declare const getCreateInviteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInvite>>, TError, {
        data: BodyType<CreateInviteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createInvite>>, TError, {
    data: BodyType<CreateInviteInput>;
}, TContext>;
export type CreateInviteMutationResult = NonNullable<Awaited<ReturnType<typeof createInvite>>>;
export type CreateInviteMutationBody = BodyType<CreateInviteInput>;
export type CreateInviteMutationError = ErrorType<unknown>;
/**
* @summary Create a company invite (manager+)
*/
export declare const useCreateInvite: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInvite>>, TError, {
        data: BodyType<CreateInviteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createInvite>>, TError, {
    data: BodyType<CreateInviteInput>;
}, TContext>;
export declare const getListInvitesUrl: () => string;
/**
 * @summary List company invites (manager+)
 */
export declare const listInvites: (options?: RequestInit) => Promise<Invite[]>;
export declare const getListInvitesQueryKey: () => readonly ["/api/auth/invites"];
export declare const getListInvitesQueryOptions: <TData = Awaited<ReturnType<typeof listInvites>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listInvites>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listInvites>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListInvitesQueryResult = NonNullable<Awaited<ReturnType<typeof listInvites>>>;
export type ListInvitesQueryError = ErrorType<unknown>;
/**
 * @summary List company invites (manager+)
 */
export declare function useListInvites<TData = Awaited<ReturnType<typeof listInvites>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listInvites>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListSalesOpportunitiesUrl: (params?: ListSalesOpportunitiesParams) => string;
/**
 * @summary List the company's opportunity log (sales, manager, owner)
 */
export declare const listSalesOpportunities: (params?: ListSalesOpportunitiesParams, options?: RequestInit) => Promise<SalesOpportunity[]>;
export declare const getListSalesOpportunitiesQueryKey: (params?: ListSalesOpportunitiesParams) => readonly ["/api/opportunities", ...ListSalesOpportunitiesParams[]];
export declare const getListSalesOpportunitiesQueryOptions: <TData = Awaited<ReturnType<typeof listSalesOpportunities>>, TError = ErrorType<unknown>>(params?: ListSalesOpportunitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSalesOpportunities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSalesOpportunities>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSalesOpportunitiesQueryResult = NonNullable<Awaited<ReturnType<typeof listSalesOpportunities>>>;
export type ListSalesOpportunitiesQueryError = ErrorType<unknown>;
/**
 * @summary List the company's opportunity log (sales, manager, owner)
 */
export declare function useListSalesOpportunities<TData = Awaited<ReturnType<typeof listSalesOpportunities>>, TError = ErrorType<unknown>>(params?: ListSalesOpportunitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSalesOpportunities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSalesOpportunityTrendsUrl: () => string;
/**
 * @summary Deterministic aggregates over the opportunity log
 */
export declare const getSalesOpportunityTrends: (options?: RequestInit) => Promise<SalesOpportunityTrends>;
export declare const getGetSalesOpportunityTrendsQueryKey: () => readonly ["/api/opportunities/trends"];
export declare const getGetSalesOpportunityTrendsQueryOptions: <TData = Awaited<ReturnType<typeof getSalesOpportunityTrends>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunityTrends>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunityTrends>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSalesOpportunityTrendsQueryResult = NonNullable<Awaited<ReturnType<typeof getSalesOpportunityTrends>>>;
export type GetSalesOpportunityTrendsQueryError = ErrorType<unknown>;
/**
 * @summary Deterministic aggregates over the opportunity log
 */
export declare function useGetSalesOpportunityTrends<TData = Awaited<ReturnType<typeof getSalesOpportunityTrends>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunityTrends>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOpportunitySettingsUrl: () => string;
/**
 * @summary Get opportunity mining settings (owner only)
 */
export declare const getOpportunitySettings: (options?: RequestInit) => Promise<OpportunitySettings>;
export declare const getGetOpportunitySettingsQueryKey: () => readonly ["/api/opportunities/settings"];
export declare const getGetOpportunitySettingsQueryOptions: <TData = Awaited<ReturnType<typeof getOpportunitySettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunitySettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOpportunitySettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOpportunitySettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getOpportunitySettings>>>;
export type GetOpportunitySettingsQueryError = ErrorType<unknown>;
/**
 * @summary Get opportunity mining settings (owner only)
 */
export declare function useGetOpportunitySettings<TData = Awaited<ReturnType<typeof getOpportunitySettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunitySettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateOpportunitySettingsUrl: () => string;
/**
 * @summary Update opportunity mining settings (owner only)
 */
export declare const updateOpportunitySettings: (opportunitySettingsUpdate: OpportunitySettingsUpdate, options?: RequestInit) => Promise<OpportunitySettings>;
export declare const getUpdateOpportunitySettingsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateOpportunitySettings>>, TError, {
        data: BodyType<OpportunitySettingsUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateOpportunitySettings>>, TError, {
    data: BodyType<OpportunitySettingsUpdate>;
}, TContext>;
export type UpdateOpportunitySettingsMutationResult = NonNullable<Awaited<ReturnType<typeof updateOpportunitySettings>>>;
export type UpdateOpportunitySettingsMutationBody = BodyType<OpportunitySettingsUpdate>;
export type UpdateOpportunitySettingsMutationError = ErrorType<unknown>;
/**
* @summary Update opportunity mining settings (owner only)
*/
export declare const useUpdateOpportunitySettings: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateOpportunitySettings>>, TError, {
        data: BodyType<OpportunitySettingsUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateOpportunitySettings>>, TError, {
    data: BodyType<OpportunitySettingsUpdate>;
}, TContext>;
export declare const getGetSalesOpportunityUrl: (id: number) => string;
/**
 * @summary Get one opportunity with its audit trail (logs a viewed event)
 */
export declare const getSalesOpportunity: (id: number, options?: RequestInit) => Promise<SalesOpportunityDetail>;
export declare const getGetSalesOpportunityQueryKey: (id: number) => readonly [`/api/opportunities/${number}`];
export declare const getGetSalesOpportunityQueryOptions: <TData = Awaited<ReturnType<typeof getSalesOpportunity>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunity>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSalesOpportunityQueryResult = NonNullable<Awaited<ReturnType<typeof getSalesOpportunity>>>;
export type GetSalesOpportunityQueryError = ErrorType<unknown>;
/**
 * @summary Get one opportunity with its audit trail (logs a viewed event)
 */
export declare function useGetSalesOpportunity<TData = Awaited<ReturnType<typeof getSalesOpportunity>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSalesOpportunity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateSalesOpportunityUrl: (id: number) => string;
/**
 * @summary Update status or assignment (dismiss requires manager+)
 */
export declare const updateSalesOpportunity: (id: number, salesOpportunityUpdate: SalesOpportunityUpdate, options?: RequestInit) => Promise<SalesOpportunity>;
export declare const getUpdateSalesOpportunityMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSalesOpportunity>>, TError, {
        id: number;
        data: BodyType<SalesOpportunityUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateSalesOpportunity>>, TError, {
    id: number;
    data: BodyType<SalesOpportunityUpdate>;
}, TContext>;
export type UpdateSalesOpportunityMutationResult = NonNullable<Awaited<ReturnType<typeof updateSalesOpportunity>>>;
export type UpdateSalesOpportunityMutationBody = BodyType<SalesOpportunityUpdate>;
export type UpdateSalesOpportunityMutationError = ErrorType<unknown>;
/**
* @summary Update status or assignment (dismiss requires manager+)
*/
export declare const useUpdateSalesOpportunity: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSalesOpportunity>>, TError, {
        id: number;
        data: BodyType<SalesOpportunityUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateSalesOpportunity>>, TError, {
    id: number;
    data: BodyType<SalesOpportunityUpdate>;
}, TContext>;
export declare const getListOpportunityNotesUrl: (id: number) => string;
/**
 * @summary Immutable notes thread, oldest first (sales, manager, owner)
 */
export declare const listOpportunityNotes: (id: number, options?: RequestInit) => Promise<OpportunityNote[]>;
export declare const getListOpportunityNotesQueryKey: (id: number) => readonly [`/api/opportunities/${number}/notes`];
export declare const getListOpportunityNotesQueryOptions: <TData = Awaited<ReturnType<typeof listOpportunityNotes>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listOpportunityNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listOpportunityNotes>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListOpportunityNotesQueryResult = NonNullable<Awaited<ReturnType<typeof listOpportunityNotes>>>;
export type ListOpportunityNotesQueryError = ErrorType<unknown>;
/**
 * @summary Immutable notes thread, oldest first (sales, manager, owner)
 */
export declare function useListOpportunityNotes<TData = Awaited<ReturnType<typeof listOpportunityNotes>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listOpportunityNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAddOpportunityNoteUrl: (id: number) => string;
/**
 * @summary Append a note (append-only — corrections are new notes)
 */
export declare const addOpportunityNote: (id: number, opportunityNoteCreate: OpportunityNoteCreate, options?: RequestInit) => Promise<OpportunityNote>;
export declare const getAddOpportunityNoteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addOpportunityNote>>, TError, {
        id: number;
        data: BodyType<OpportunityNoteCreate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addOpportunityNote>>, TError, {
    id: number;
    data: BodyType<OpportunityNoteCreate>;
}, TContext>;
export type AddOpportunityNoteMutationResult = NonNullable<Awaited<ReturnType<typeof addOpportunityNote>>>;
export type AddOpportunityNoteMutationBody = BodyType<OpportunityNoteCreate>;
export type AddOpportunityNoteMutationError = ErrorType<unknown>;
/**
* @summary Append a note (append-only — corrections are new notes)
*/
export declare const useAddOpportunityNote: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addOpportunityNote>>, TError, {
        id: number;
        data: BodyType<OpportunityNoteCreate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addOpportunityNote>>, TError, {
    id: number;
    data: BodyType<OpportunityNoteCreate>;
}, TContext>;
export declare const getListScorecardsUrl: (params?: ListScorecardsParams) => string;
/**
 * @summary List inspection scorecards, newest first (manager, owner)
 */
export declare const listScorecards: (params?: ListScorecardsParams, options?: RequestInit) => Promise<InspectionScorecardListItem[]>;
export declare const getListScorecardsQueryKey: (params?: ListScorecardsParams) => readonly ["/api/scorecards", ...ListScorecardsParams[]];
export declare const getListScorecardsQueryOptions: <TData = Awaited<ReturnType<typeof listScorecards>>, TError = ErrorType<unknown>>(params?: ListScorecardsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listScorecards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listScorecards>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListScorecardsQueryResult = NonNullable<Awaited<ReturnType<typeof listScorecards>>>;
export type ListScorecardsQueryError = ErrorType<unknown>;
/**
 * @summary List inspection scorecards, newest first (manager, owner)
 */
export declare function useListScorecards<TData = Awaited<ReturnType<typeof listScorecards>>, TError = ErrorType<unknown>>(params?: ListScorecardsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listScorecards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetScorecardSummaryUrl: () => string;
/**
 * @summary Deterministic management-intelligence aggregates (manager, owner)
 */
export declare const getScorecardSummary: (options?: RequestInit) => Promise<ScorecardSummary>;
export declare const getGetScorecardSummaryQueryKey: () => readonly ["/api/scorecards/summary"];
export declare const getGetScorecardSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getScorecardSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getScorecardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getScorecardSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetScorecardSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getScorecardSummary>>>;
export type GetScorecardSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Deterministic management-intelligence aggregates (manager, owner)
 */
export declare function useGetScorecardSummary<TData = Awaited<ReturnType<typeof getScorecardSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getScorecardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetInspectionScorecardUrl: (inspectionId: number) => string;
/**
 * @summary Get one inspection's scorecard (manager, owner)
 */
export declare const getInspectionScorecard: (inspectionId: number, options?: RequestInit) => Promise<InspectionScorecard>;
export declare const getGetInspectionScorecardQueryKey: (inspectionId: number) => readonly [`/api/scorecards/inspection/${number}`];
export declare const getGetInspectionScorecardQueryOptions: <TData = Awaited<ReturnType<typeof getInspectionScorecard>>, TError = ErrorType<unknown>>(inspectionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInspectionScorecard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getInspectionScorecard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetInspectionScorecardQueryResult = NonNullable<Awaited<ReturnType<typeof getInspectionScorecard>>>;
export type GetInspectionScorecardQueryError = ErrorType<unknown>;
/**
 * @summary Get one inspection's scorecard (manager, owner)
 */
export declare function useGetInspectionScorecard<TData = Awaited<ReturnType<typeof getInspectionScorecard>>, TError = ErrorType<unknown>>(inspectionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getInspectionScorecard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCustomerSummaryForInspectionUrl: (inspectionId: number) => string;
/**
 * @summary Get the inspection's customer summary (manager, owner)
 */
export declare const getCustomerSummaryForInspection: (inspectionId: number, options?: RequestInit) => Promise<CustomerSummary>;
export declare const getGetCustomerSummaryForInspectionQueryKey: (inspectionId: number) => readonly [`/api/customer-summaries/inspection/${number}`];
export declare const getGetCustomerSummaryForInspectionQueryOptions: <TData = Awaited<ReturnType<typeof getCustomerSummaryForInspection>>, TError = ErrorType<unknown>>(inspectionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCustomerSummaryForInspection>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCustomerSummaryForInspection>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCustomerSummaryForInspectionQueryResult = NonNullable<Awaited<ReturnType<typeof getCustomerSummaryForInspection>>>;
export type GetCustomerSummaryForInspectionQueryError = ErrorType<unknown>;
/**
 * @summary Get the inspection's customer summary (manager, owner)
 */
export declare function useGetCustomerSummaryForInspection<TData = Awaited<ReturnType<typeof getCustomerSummaryForInspection>>, TError = ErrorType<unknown>>(inspectionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCustomerSummaryForInspection>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGenerateCustomerSummaryUrl: (inspectionId: number) => string;
/**
 * @summary Generate/regenerate the draft from the latest analysis (manager, owner)
 */
export declare const generateCustomerSummary: (inspectionId: number, options?: RequestInit) => Promise<CustomerSummary>;
export declare const getGenerateCustomerSummaryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateCustomerSummary>>, TError, {
        inspectionId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateCustomerSummary>>, TError, {
    inspectionId: number;
}, TContext>;
export type GenerateCustomerSummaryMutationResult = NonNullable<Awaited<ReturnType<typeof generateCustomerSummary>>>;
export type GenerateCustomerSummaryMutationError = ErrorType<unknown>;
/**
* @summary Generate/regenerate the draft from the latest analysis (manager, owner)
*/
export declare const useGenerateCustomerSummary: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateCustomerSummary>>, TError, {
        inspectionId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateCustomerSummary>>, TError, {
    inspectionId: number;
}, TContext>;
export declare const getUpdateCustomerSummaryUrl: (id: number) => string;
/**
 * @summary Edit the draft body (drafts only — approved summaries are frozen)
 */
export declare const updateCustomerSummary: (id: number, customerSummaryUpdate: CustomerSummaryUpdate, options?: RequestInit) => Promise<CustomerSummary>;
export declare const getUpdateCustomerSummaryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCustomerSummary>>, TError, {
        id: number;
        data: BodyType<CustomerSummaryUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateCustomerSummary>>, TError, {
    id: number;
    data: BodyType<CustomerSummaryUpdate>;
}, TContext>;
export type UpdateCustomerSummaryMutationResult = NonNullable<Awaited<ReturnType<typeof updateCustomerSummary>>>;
export type UpdateCustomerSummaryMutationBody = BodyType<CustomerSummaryUpdate>;
export type UpdateCustomerSummaryMutationError = ErrorType<unknown>;
/**
* @summary Edit the draft body (drafts only — approved summaries are frozen)
*/
export declare const useUpdateCustomerSummary: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCustomerSummary>>, TError, {
        id: number;
        data: BodyType<CustomerSummaryUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateCustomerSummary>>, TError, {
    id: number;
    data: BodyType<CustomerSummaryUpdate>;
}, TContext>;
export declare const getApproveCustomerSummaryUrl: (id: number) => string;
/**
 * @summary Approve — freezes the body and mints the expiring share token
 */
export declare const approveCustomerSummary: (id: number, customerSummaryApprove?: CustomerSummaryApprove, options?: RequestInit) => Promise<CustomerSummary>;
export declare const getApproveCustomerSummaryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveCustomerSummary>>, TError, {
        id: number;
        data?: BodyType<CustomerSummaryApprove>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof approveCustomerSummary>>, TError, {
    id: number;
    data?: BodyType<CustomerSummaryApprove>;
}, TContext>;
export type ApproveCustomerSummaryMutationResult = NonNullable<Awaited<ReturnType<typeof approveCustomerSummary>>>;
export type ApproveCustomerSummaryMutationBody = BodyType<CustomerSummaryApprove> | undefined;
export type ApproveCustomerSummaryMutationError = ErrorType<unknown>;
/**
* @summary Approve — freezes the body and mints the expiring share token
*/
export declare const useApproveCustomerSummary: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveCustomerSummary>>, TError, {
        id: number;
        data?: BodyType<CustomerSummaryApprove>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof approveCustomerSummary>>, TError, {
    id: number;
    data?: BodyType<CustomerSummaryApprove>;
}, TContext>;
export declare const getRevokeCustomerSummaryShareUrl: (id: number) => string;
/**
 * @summary Revoke the public share link immediately
 */
export declare const revokeCustomerSummaryShare: (id: number, options?: RequestInit) => Promise<CustomerSummary>;
export declare const getRevokeCustomerSummaryShareMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeCustomerSummaryShare>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof revokeCustomerSummaryShare>>, TError, {
    id: number;
}, TContext>;
export type RevokeCustomerSummaryShareMutationResult = NonNullable<Awaited<ReturnType<typeof revokeCustomerSummaryShare>>>;
export type RevokeCustomerSummaryShareMutationError = ErrorType<unknown>;
/**
* @summary Revoke the public share link immediately
*/
export declare const useRevokeCustomerSummaryShare: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeCustomerSummaryShare>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof revokeCustomerSummaryShare>>, TError, {
    id: number;
}, TContext>;
export declare const getListProposalsUrl: (params?: ListProposalsParams) => string;
/**
 * @summary List proposals, newest first (sales, manager, owner)
 */
export declare const listProposals: (params?: ListProposalsParams, options?: RequestInit) => Promise<SalesProposal[]>;
export declare const getListProposalsQueryKey: (params?: ListProposalsParams) => readonly ["/api/proposals", ...ListProposalsParams[]];
export declare const getListProposalsQueryOptions: <TData = Awaited<ReturnType<typeof listProposals>>, TError = ErrorType<unknown>>(params?: ListProposalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProposals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProposals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProposalsQueryResult = NonNullable<Awaited<ReturnType<typeof listProposals>>>;
export type ListProposalsQueryError = ErrorType<unknown>;
/**
 * @summary List proposals, newest first (sales, manager, owner)
 */
export declare function useListProposals<TData = Awaited<ReturnType<typeof listProposals>>, TError = ErrorType<unknown>>(params?: ListProposalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProposals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateProposalUrl: () => string;
/**
 * @summary Assemble a proposal from same-company opportunity IDs
 */
export declare const createProposal: (salesProposalCreate: SalesProposalCreate, options?: RequestInit) => Promise<SalesProposal>;
export declare const getCreateProposalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProposal>>, TError, {
        data: BodyType<SalesProposalCreate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createProposal>>, TError, {
    data: BodyType<SalesProposalCreate>;
}, TContext>;
export type CreateProposalMutationResult = NonNullable<Awaited<ReturnType<typeof createProposal>>>;
export type CreateProposalMutationBody = BodyType<SalesProposalCreate>;
export type CreateProposalMutationError = ErrorType<unknown>;
/**
* @summary Assemble a proposal from same-company opportunity IDs
*/
export declare const useCreateProposal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProposal>>, TError, {
        data: BodyType<SalesProposalCreate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createProposal>>, TError, {
    data: BodyType<SalesProposalCreate>;
}, TContext>;
export declare const getGetProposalUrl: (id: number) => string;
/**
 * @summary Get one proposal with its resolved opportunities
 */
export declare const getProposal: (id: number, options?: RequestInit) => Promise<SalesProposalDetail>;
export declare const getGetProposalQueryKey: (id: number) => readonly [`/api/proposals/${number}`];
export declare const getGetProposalQueryOptions: <TData = Awaited<ReturnType<typeof getProposal>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProposal>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProposal>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProposalQueryResult = NonNullable<Awaited<ReturnType<typeof getProposal>>>;
export type GetProposalQueryError = ErrorType<unknown>;
/**
 * @summary Get one proposal with its resolved opportunities
 */
export declare function useGetProposal<TData = Awaited<ReturnType<typeof getProposal>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProposal>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateProposalUrl: (id: number) => string;
/**
 * @summary Edit content or move the paperwork status
 */
export declare const updateProposal: (id: number, salesProposalUpdate: SalesProposalUpdate, options?: RequestInit) => Promise<SalesProposal>;
export declare const getUpdateProposalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProposal>>, TError, {
        id: number;
        data: BodyType<SalesProposalUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateProposal>>, TError, {
    id: number;
    data: BodyType<SalesProposalUpdate>;
}, TContext>;
export type UpdateProposalMutationResult = NonNullable<Awaited<ReturnType<typeof updateProposal>>>;
export type UpdateProposalMutationBody = BodyType<SalesProposalUpdate>;
export type UpdateProposalMutationError = ErrorType<unknown>;
/**
* @summary Edit content or move the paperwork status
*/
export declare const useUpdateProposal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProposal>>, TError, {
        id: number;
        data: BodyType<SalesProposalUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateProposal>>, TError, {
    id: number;
    data: BodyType<SalesProposalUpdate>;
}, TContext>;
export declare const getDeleteProposalUrl: (id: number) => string;
/**
 * @summary Delete a draft proposal (sent/decided proposals are records)
 */
export declare const deleteProposal: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteProposalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProposal>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteProposal>>, TError, {
    id: number;
}, TContext>;
export type DeleteProposalMutationResult = NonNullable<Awaited<ReturnType<typeof deleteProposal>>>;
export type DeleteProposalMutationError = ErrorType<unknown>;
/**
* @summary Delete a draft proposal (sent/decided proposals are records)
*/
export declare const useDeleteProposal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProposal>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteProposal>>, TError, {
    id: number;
}, TContext>;
export declare const getGetBriefingUrl: () => string;
/**
 * @summary Get the caller's role-shaped intelligence briefing
 */
export declare const getBriefing: (options?: RequestInit) => Promise<RoleBriefing>;
export declare const getGetBriefingQueryKey: () => readonly ["/api/briefing"];
export declare const getGetBriefingQueryOptions: <TData = Awaited<ReturnType<typeof getBriefing>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBriefing>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBriefing>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBriefingQueryResult = NonNullable<Awaited<ReturnType<typeof getBriefing>>>;
export type GetBriefingQueryError = ErrorType<unknown>;
/**
 * @summary Get the caller's role-shaped intelligence briefing
 */
export declare function useGetBriefing<TData = Awaited<ReturnType<typeof getBriefing>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBriefing>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListGeminiConversationsUrl: () => string;
/**
 * @summary List all conversations
 */
export declare const listGeminiConversations: (options?: RequestInit) => Promise<GeminiConversation[]>;
export declare const getListGeminiConversationsQueryKey: () => readonly ["/api/gemini/conversations"];
export declare const getListGeminiConversationsQueryOptions: <TData = Awaited<ReturnType<typeof listGeminiConversations>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listGeminiConversations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listGeminiConversations>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListGeminiConversationsQueryResult = NonNullable<Awaited<ReturnType<typeof listGeminiConversations>>>;
export type ListGeminiConversationsQueryError = ErrorType<unknown>;
/**
 * @summary List all conversations
 */
export declare function useListGeminiConversations<TData = Awaited<ReturnType<typeof listGeminiConversations>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listGeminiConversations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateGeminiConversationUrl: () => string;
/**
 * @summary Create a new conversation
 */
export declare const createGeminiConversation: (geminiConversationInput: GeminiConversationInput, options?: RequestInit) => Promise<GeminiConversation>;
export declare const getCreateGeminiConversationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createGeminiConversation>>, TError, {
        data: BodyType<GeminiConversationInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createGeminiConversation>>, TError, {
    data: BodyType<GeminiConversationInput>;
}, TContext>;
export type CreateGeminiConversationMutationResult = NonNullable<Awaited<ReturnType<typeof createGeminiConversation>>>;
export type CreateGeminiConversationMutationBody = BodyType<GeminiConversationInput>;
export type CreateGeminiConversationMutationError = ErrorType<unknown>;
/**
* @summary Create a new conversation
*/
export declare const useCreateGeminiConversation: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createGeminiConversation>>, TError, {
        data: BodyType<GeminiConversationInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createGeminiConversation>>, TError, {
    data: BodyType<GeminiConversationInput>;
}, TContext>;
export declare const getGetGeminiConversationUrl: (id: number) => string;
/**
 * @summary Get conversation with messages
 */
export declare const getGeminiConversation: (id: number, options?: RequestInit) => Promise<GeminiConversationWithMessages>;
export declare const getGetGeminiConversationQueryKey: (id: number) => readonly [`/api/gemini/conversations/${number}`];
export declare const getGetGeminiConversationQueryOptions: <TData = Awaited<ReturnType<typeof getGeminiConversation>>, TError = ErrorType<GeminiError>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGeminiConversation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getGeminiConversation>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetGeminiConversationQueryResult = NonNullable<Awaited<ReturnType<typeof getGeminiConversation>>>;
export type GetGeminiConversationQueryError = ErrorType<GeminiError>;
/**
 * @summary Get conversation with messages
 */
export declare function useGetGeminiConversation<TData = Awaited<ReturnType<typeof getGeminiConversation>>, TError = ErrorType<GeminiError>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGeminiConversation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDeleteGeminiConversationUrl: (id: number) => string;
/**
 * @summary Delete a conversation
 */
export declare const deleteGeminiConversation: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteGeminiConversationMutationOptions: <TError = ErrorType<GeminiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteGeminiConversation>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteGeminiConversation>>, TError, {
    id: number;
}, TContext>;
export type DeleteGeminiConversationMutationResult = NonNullable<Awaited<ReturnType<typeof deleteGeminiConversation>>>;
export type DeleteGeminiConversationMutationError = ErrorType<GeminiError>;
/**
* @summary Delete a conversation
*/
export declare const useDeleteGeminiConversation: <TError = ErrorType<GeminiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteGeminiConversation>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteGeminiConversation>>, TError, {
    id: number;
}, TContext>;
export declare const getListGeminiMessagesUrl: (id: number) => string;
/**
 * @summary List messages in a conversation
 */
export declare const listGeminiMessages: (id: number, options?: RequestInit) => Promise<GeminiMessage[]>;
export declare const getListGeminiMessagesQueryKey: (id: number) => readonly [`/api/gemini/conversations/${number}/messages`];
export declare const getListGeminiMessagesQueryOptions: <TData = Awaited<ReturnType<typeof listGeminiMessages>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listGeminiMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listGeminiMessages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListGeminiMessagesQueryResult = NonNullable<Awaited<ReturnType<typeof listGeminiMessages>>>;
export type ListGeminiMessagesQueryError = ErrorType<unknown>;
/**
 * @summary List messages in a conversation
 */
export declare function useListGeminiMessages<TData = Awaited<ReturnType<typeof listGeminiMessages>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listGeminiMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSendGeminiMessageUrl: (id: number) => string;
/**
 * @summary Send a message and receive an AI response (SSE stream)
 */
export declare const sendGeminiMessage: (id: number, geminiMessageInput: GeminiMessageInput, options?: RequestInit) => Promise<unknown>;
export declare const getSendGeminiMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendGeminiMessage>>, TError, {
        id: number;
        data: BodyType<GeminiMessageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendGeminiMessage>>, TError, {
    id: number;
    data: BodyType<GeminiMessageInput>;
}, TContext>;
export type SendGeminiMessageMutationResult = NonNullable<Awaited<ReturnType<typeof sendGeminiMessage>>>;
export type SendGeminiMessageMutationBody = BodyType<GeminiMessageInput>;
export type SendGeminiMessageMutationError = ErrorType<unknown>;
/**
* @summary Send a message and receive an AI response (SSE stream)
*/
export declare const useSendGeminiMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendGeminiMessage>>, TError, {
        id: number;
        data: BodyType<GeminiMessageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendGeminiMessage>>, TError, {
    id: number;
    data: BodyType<GeminiMessageInput>;
}, TContext>;
export declare const getGenerateGeminiImageUrl: () => string;
/**
 * @summary Generate an image from a text prompt
 */
export declare const generateGeminiImage: (geminiImageInput: GeminiImageInput, options?: RequestInit) => Promise<GeminiImageOutput>;
export declare const getGenerateGeminiImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateGeminiImage>>, TError, {
        data: BodyType<GeminiImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateGeminiImage>>, TError, {
    data: BodyType<GeminiImageInput>;
}, TContext>;
export type GenerateGeminiImageMutationResult = NonNullable<Awaited<ReturnType<typeof generateGeminiImage>>>;
export type GenerateGeminiImageMutationBody = BodyType<GeminiImageInput>;
export type GenerateGeminiImageMutationError = ErrorType<unknown>;
/**
* @summary Generate an image from a text prompt
*/
export declare const useGenerateGeminiImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateGeminiImage>>, TError, {
        data: BodyType<GeminiImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateGeminiImage>>, TError, {
    data: BodyType<GeminiImageInput>;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map