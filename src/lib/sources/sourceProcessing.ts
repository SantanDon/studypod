export const SOURCE_PROCESSING_STATUSES = [
  'pending',
  'uploading',
  'extracting',
  'processing',
  'indexing',
  'completed',
  'ready',
  'degraded',
  'failed',
  'cancelled',
] as const;

export type SourceProcessingStatus = (typeof SOURCE_PROCESSING_STATUSES)[number];

export interface SourceProcessingError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  occurredAt: string;
}

export interface SourceProcessingMetadata extends Record<string, unknown> {
  processingStage?: string;
  processingError?: SourceProcessingError;
  processedAt?: string;
  chunks?: unknown[];
  documentEmbedding?: unknown;
  transcriptStatus?: string;
  transcriptLineCount?: number;
  extractionWarning?: string;
  extractedBy?: string;
  transcriptProvider?: string;
  transcriptMode?: string;
  transcriptLanguage?: string | null;
  availableTranscriptLanguages?: string[];
  timestampedTranscript?: boolean;
  transcriptSegments?: Array<{ text: string; offset: number; duration: number; lang?: string | null }>;
  supadataBillableRequests?: number;
  channelId?: string | null;
  thumbnail?: string | null;
  publishedAt?: string | null;
  canonicalUrl?: string | null;
  providerCapabilities?: {
    seekableCitations?: boolean;
    timestampedSegments?: boolean;
    metadata?: boolean;
  };
}

export interface ProcessableSourceLike {
  type?: string;
  content?: string;
  processing_status?: string;
  processingStatus?: string;
  metadata?: unknown;
}

export function parseSourceProcessingMetadata(metadata: unknown): SourceProcessingMetadata {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as SourceProcessingMetadata;
    } catch {
      return {};
    }
  }
  return typeof metadata === 'object'
    ? (metadata as SourceProcessingMetadata)
    : {};
}

export function getSourceProcessingStatus(source: ProcessableSourceLike): SourceProcessingStatus | string {
  return source.processing_status || source.processingStatus || 'pending';
}

export function hasUsableSourceContent(source: ProcessableSourceLike): boolean {
  return typeof source.content === 'string' && source.content.trim().length > 0;
}

export function isSourceUsableForGroundedWork(source: ProcessableSourceLike): boolean {
  const status = getSourceProcessingStatus(source);
  const metadata = parseSourceProcessingMetadata(source.metadata);
  const isMetadataOnlyYoutube = source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  const readyStatus = status === 'completed' || status === 'ready' || status === 'degraded';

  return readyStatus && hasUsableSourceContent(source) && !isMetadataOnlyYoutube;
}

export function isSourceUsableForGroundedChat(source: ProcessableSourceLike): boolean {
  const status = getSourceProcessingStatus(source);
  const metadata = parseSourceProcessingMetadata(source.metadata);
  const isMetadataOnlyYoutube = source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  const terminalFailure = status === 'failed' || status === 'cancelled';

  // Chat can safely use reliable extracted text before semantic indexing has
  // finished. Keep richer study-generation workflows on the stricter
  // isSourceUsableForGroundedWork contract above.
  return !terminalFailure && hasUsableSourceContent(source) && !isMetadataOnlyYoutube;
}

export function shouldSkipClientSemanticIndexing(
  contentLength: number,
  maxCharacters = 250_000,
): boolean {
  return Number.isFinite(contentLength)
    && Number.isFinite(maxCharacters)
    && maxCharacters >= 0
    && contentLength > maxCharacters;
}

/**
 * Audiobook imports arrive with their text already extracted and do not pass
 * through the upload/indexing mutation. Mark that text as keyword-ready at
 * creation time instead of leaving it indefinitely pending. This does not
 * claim that semantic indexing completed.
 */
export function getInitialSourceProcessingState(
  sourceType: string,
  content: string | undefined,
  metadata: unknown,
  requestedStatus?: SourceProcessingStatus,
): { processing_status?: SourceProcessingStatus; metadata: SourceProcessingMetadata } {
  const parsedMetadata = parseSourceProcessingMetadata(metadata);
  if (sourceType !== 'ebook' || !content?.trim() || (requestedStatus && requestedStatus !== 'pending')) {
    return { processing_status: requestedStatus, metadata: parsedMetadata };
  }

  return {
    processing_status: 'degraded',
    metadata: {
      ...parsedMetadata,
      processingStage: 'degraded',
      processingError: buildSourceProcessingError(
        'SOURCE_INDEXING_SKIPPED_IMPORT',
        'Extracted book text is available for keyword-grounded work; semantic indexing was not run during import.',
        'indexing',
        false,
      ),
      indexingSkipped: true,
      indexingStrategy: 'keyword_only',
      contentLength: content.length,
      processedAt: new Date().toISOString(),
    },
  };
}

/** Build a safe, metadata-preserving recovery update for an existing ebook. */
export function getPendingEbookRecoveryUpdates(
  source: ProcessableSourceLike,
): { processing_status: SourceProcessingStatus; metadata: SourceProcessingMetadata } | null {
  if (source.type !== 'ebook' || getSourceProcessingStatus(source) !== 'pending' || !hasUsableSourceContent(source)) {
    return null;
  }

  return getInitialSourceProcessingState('ebook', source.content, source.metadata, 'pending') as {
    processing_status: SourceProcessingStatus;
    metadata: SourceProcessingMetadata;
  };
}

export function buildSourceProcessingError(
  code: string,
  message: string,
  stage: string,
  retryable = true,
): SourceProcessingError {
  return {
    code,
    message,
    stage,
    retryable,
    occurredAt: new Date().toISOString(),
  };
}
