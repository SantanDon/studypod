import { describe, expect, it } from 'vitest';
import {
  buildSourceProcessingError,
  getInitialSourceProcessingState,
  getPendingEbookRecoveryUpdates,
  isSourceUsableForGroundedChat,
  isSourceUsableForGroundedWork,
  parseSourceProcessingMetadata,
  shouldSkipClientSemanticIndexing,
} from '@/lib/sources/sourceProcessing';

describe('source processing contract', () => {
  it('accepts completed sources with usable content', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: 'Extracted source text',
      processing_status: 'completed',
    })).toBe(true);
  });

  it('keeps degraded sources usable when extracted text remains available', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'website',
      content: 'Readable article text',
      processing_status: 'degraded',
    })).toBe(true);
  });

  it('lets chat use extracted text while indexing continues without unlocking richer grounded work', () => {
    const source = {
      type: 'pdf',
      content: 'Reliable extracted text is already available.',
      processing_status: 'processing',
    };

    expect(isSourceUsableForGroundedChat(source)).toBe(true);
    expect(isSourceUsableForGroundedWork(source)).toBe(false);
  });

  it('rejects failed and empty sources', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: 'Extraction failed',
      processing_status: 'failed',
    })).toBe(false);

    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: '   ',
      processing_status: 'completed',
    })).toBe(false);
  });

  it('rejects metadata-only YouTube sources', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'youtube',
      content: 'Video title and description',
      processing_status: 'completed',
      metadata: JSON.stringify({ transcriptStatus: 'metadata_only' }),
    })).toBe(false);
  });

  it('skips expensive client indexing for oversized sources without rejecting their text', () => {
    expect(shouldSkipClientSemanticIndexing(757_010, 250_000)).toBe(true);
    expect(shouldSkipClientSemanticIndexing(250_000, 250_000)).toBe(false);
    expect(shouldSkipClientSemanticIndexing(249_999, 250_000)).toBe(false);
  });

  it('makes pre-extracted ebook imports available without claiming semantic indexing completed', () => {
    const state = getInitialSourceProcessingState(
      'ebook',
      'Full chapter text',
      { chapters: [{ title: 'Book I' }], source: 'gutenberg' },
    );

    expect(state.processing_status).toBe('degraded');
    expect(state.metadata).toMatchObject({
      chapters: [{ title: 'Book I' }],
      source: 'gutenberg',
      processingStage: 'degraded',
      processingError: {
        code: 'SOURCE_INDEXING_SKIPPED_IMPORT',
        retryable: false,
      },
      indexingSkipped: true,
      indexingStrategy: 'keyword_only',
      contentLength: 17,
    });
    expect(isSourceUsableForGroundedWork({
      type: 'ebook',
      content: 'Full chapter text',
      processing_status: state.processing_status,
      metadata: state.metadata,
    })).toBe(true);
  });

  it('leaves empty ebooks pending and respects explicit terminal states', () => {
    expect(getInitialSourceProcessingState('ebook', '', {}, 'pending').processing_status).toBe('pending');
    expect(getInitialSourceProcessingState('ebook', 'text', {}, 'failed').processing_status).toBe('failed');
    expect(getInitialSourceProcessingState('pdf', 'text', {}, 'pending').processing_status).toBe('pending');
  });

  it('recovers existing pending ebook text through a metadata-preserving retry update', () => {
    const updates = getPendingEbookRecoveryUpdates({
      type: 'ebook',
      content: 'Existing chapter text',
      processing_status: 'pending',
      metadata: JSON.stringify({ chapters: [{ title: 'Book I' }], source: 'gutenberg' }),
    });

    expect(updates).toMatchObject({
      processing_status: 'degraded',
      metadata: {
        chapters: [{ title: 'Book I' }],
        source: 'gutenberg',
        indexingSkipped: true,
        indexingStrategy: 'keyword_only',
        processingError: { code: 'SOURCE_INDEXING_SKIPPED_IMPORT' },
      },
    });
    expect(getPendingEbookRecoveryUpdates({
      type: 'pdf', content: 'text', processing_status: 'pending',
    })).toBeNull();
    expect(getPendingEbookRecoveryUpdates({
      type: 'ebook', content: '', processing_status: 'pending',
    })).toBeNull();
  });

  it('parses serialized metadata and creates structured retry errors', () => {
    expect(parseSourceProcessingMetadata('{"processingStage":"indexing"}')).toEqual({
      processingStage: 'indexing',
    });

    const error = buildSourceProcessingError(
      'SOURCE_INDEXING_FAILED',
      'Embedding provider unavailable',
      'indexing',
    );

    expect(error).toMatchObject({
      code: 'SOURCE_INDEXING_FAILED',
      message: 'Embedding provider unavailable',
      stage: 'indexing',
      retryable: true,
    });
    expect(Number.isNaN(Date.parse(error.occurredAt))).toBe(false);
  });
});
