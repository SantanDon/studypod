import type { Citation, EnhancedChatMessage } from '@/types/message';

// Older rows contain an array of source IDs. Those cannot recreate evidence.
export function mapPersistedMessage(row: Record<string, unknown>): EnhancedChatMessage {
  const text = typeof row.content === 'string' ? row.content : '';
  let metadata: unknown = row.groundedSources ?? row.grounded_sources;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = undefined; }
  }
  const envelope = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : undefined;
  const citations: Citation[] = envelope?.version === 1 && Array.isArray(envelope.citations)
    ? envelope.citations.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const citationId = Number(item.citation_id);
      if (!Number.isInteger(citationId) || citationId < 1 || typeof item.source_id !== 'string') return [];
      return [{ ...item, citation_id: citationId,
        source_id: item.source_id,
        source_title: typeof item.source_title === 'string' ? item.source_title : 'Source',
        source_type: typeof item.source_type === 'string' ? item.source_type : 'text',
      } as Citation];
    }) : [];
  const assistant = row.role !== 'user';
  return {
    id: String(row.id),
    notebook_id: String(row.notebookId ?? row.notebook_id ?? ''),
    created_at: typeof (row.createdAt ?? row.created_at) === 'string' ? String(row.createdAt ?? row.created_at) : undefined,
    message: { type: assistant ? 'ai' : 'human', content: assistant && citations.length
      ? { segments: [{ text }], citations } : text },
  };
}
