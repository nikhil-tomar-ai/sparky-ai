import { ColumnAnalysis, DatasetStatus, ProcessingRow } from '../server/types/models';

export interface DatasetSummary {
  id: string;
  fileName: string;
  fileSize: number;
  totalRows: number;
  totalColumns: number;
  status: DatasetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDatasetResult {
  datasetId: string;
  fileName: string;
  totalRows: number;
  totalColumns: number;
  status: DatasetStatus;
}

export interface PaginatedRowsResult {
  rows: ProcessingRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
}

export interface DatasetDetailsResult extends DatasetSummary {
  originalFileName: string;
  storedFileName: string;
  errorMessage?: string;
}

export interface ColumnAnalysisResult {
  datasetId: string;
  totalColumns: number;
  columns: ColumnAnalysis[];
}

/**
 * Section 42: Centralized API Client
 * Encapsulates all backend HTTP communication, status validation, and error normalization.
 */
class ApiClient {
  private baseUrl = '/api';

  private async handleResponse<T>(res: Response): Promise<T> {
    const json = await res.json();
    if (!res.ok || json.success === false) {
      const err = json.error || {
        code: 'REQUEST_FAILED',
        message: json.message || `Request failed with status ${res.status}`
      };
      const errorObj: any = new Error(err.message);
      errorObj.code = err.code;
      errorObj.details = err.details;
      throw errorObj;
    }
    return json.data as T;
  }

  public async humanizeDocument(params: {
    title: string;
    content: string;
    tone?: string;
    customPrompt?: string;
    intensity?: 'light' | 'balanced' | 'deep';
    temperature?: number;
    preserveKeywords?: string[];
  }): Promise<{
    success: boolean;
    title: string;
    humanizedMarkdown: string;
    modelUsed: string;
    providerUsed: string;
    timestamp: string;
  }> {
    const res = await fetch(`${this.baseUrl}/humanize-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Document humanization failed with status ${res.status}`);
    }
    return res.json();
  }

  public async humanizeDocumentSection(params: {
    sectionHeading: string;
    sectionLevel: number;
    content: string;
    documentTitle: string;
    tone?: string;
    customPrompt?: string;
    intensity?: 'light' | 'balanced' | 'deep';
    temperature?: number;
    preserveKeywords?: string[];
  }): Promise<{
    success: boolean;
    sectionHeading: string;
    humanizedContent: string;
    modelUsed: string;
    providerUsed: string;
  }> {
    const res = await fetch(`${this.baseUrl}/humanize-document-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Section humanization failed with status ${res.status}`);
    }
    return res.json();
  }
}

export const api = new ApiClient();

