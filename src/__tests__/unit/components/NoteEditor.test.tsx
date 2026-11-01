import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NoteEditor from '@/components/notebook/NoteEditor';

vi.mock('@/components/chat/MarkdownRenderer', () => ({ default: () => null }));
vi.mock('@/lib/ai/ollamaService', () => ({ generateTitle: vi.fn() }));

describe('Studio note editing', () => {
  function setup(isLoading = false) {
    const onSave = vi.fn();
    render(<NoteEditor onSave={onSave} onCancel={vi.fn()} isLoading={isLoading} />);
    const title = screen.getByRole('textbox', { name: 'Note title' });
    const content = screen.getByRole('textbox', { name: 'Note content' });
    fireEvent.change(title, { target: { value: '  Revision notes  ' } });
    fireEvent.change(content, { target: { value: '  Review the source evidence.  ' } });
    return { onSave, title, content };
  }

  it.each(['ctrlKey', 'metaKey'])('saves the current draft with %s+S', (modifier) => {
    const { onSave, content } = setup();
    fireEvent.keyDown(content, { key: 's', [modifier]: true });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Revision notes', 'Review the source evidence.');
  });

  it('does not save an empty draft through the shortcut', () => {
    const { onSave, title, content } = setup();
    fireEvent.change(title, { target: { value: ' ' } });
    fireEvent.keyDown(content, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit again while a save is in progress', () => {
    const { onSave, content } = setup(true);
    fireEvent.keyDown(content, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('does not save partially composed text', () => {
    const { onSave, content } = setup();
    fireEvent.keyDown(content, { key: 's', ctrlKey: true, isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
  });
});
