import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DocumentWorkspace from '@/components/notebook/DocumentWorkspace';
import type { DocumentArtifact } from '@/types/document';

const mocks = vi.hoisted(() => ({ updateDocument: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useSources', () => ({ useSources: () => ({ sources: [{ id: 'source-1', title: 'Cedar evidence', type: 'text' }] }) }));
vi.mock('@/components/chat/MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('@/hooks/useDocuments', () => ({ useDocuments: () => ({
  updateDocument: mocks.updateDocument, getVersions: async () => [],
  isAuthenticated: true, isSaving: false, isRevising: false,
}) }));

const document = {
  id: 'document-1', notebookId: 'notebook-1', title: 'Cedar study',
  content: '17 blue trays', status: 'draft', currentVersion: 1,
  sourceIds: ['source-1'], metadata: {},
} as DocumentArtifact;
afterEach(cleanup);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it('requires saving an evidence-only edit before revision or export and persists that scope', async () => {
  mocks.updateDocument.mockResolvedValue({ ...document, sourceIds: [], currentVersion: 2 });
  const onDocumentChange = vi.fn();
  render(<DocumentWorkspace notebookId="notebook-1" document={document} onBack={vi.fn()} onDocumentChange={onDocumentChange} />);
  fireEvent.change(screen.getByLabelText('Revision instruction'), { target: { value: 'Improve clarity' } });
  expect(screen.getByRole('button', { name: 'Revise document' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Cedar evidence/ }));
  expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Revise document' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Word (.docx)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
  await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: [], currentVersion: 2 })));
  expect(mocks.updateDocument).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ sourceIds: [], expectedVersion: 1 }) }));
});

it('returns to a saved state when an evidence selection change is undone', () => {
  render(<DocumentWorkspace notebookId="notebook-1" document={document} onBack={vi.fn()} onDocumentChange={vi.fn()} />);
  const source = screen.getByRole('checkbox', { name: /Cedar evidence/ });
  fireEvent.click(source);
  expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled();
  fireEvent.click(source);
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Word (.docx)' })).toBeEnabled();
});
