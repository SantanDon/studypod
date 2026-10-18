import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YouTubeUrlInput from '@/components/notebook/YouTubeUrlInput';
const limits = vi.hoisted(() => ({ refreshStatus: vi.fn(), canExtract: vi.fn(() => true) }));
vi.mock('@/hooks/useUsageLimits', () => ({ useUsageLimits: () => ({ status: null, ...limits }) }));
describe('YouTube URL dialog', () => {
  beforeEach(() => { vi.clearAllMocks(); limits.canExtract.mockReturnValue(true); });
  it.each(['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ'])('accepts supported mobile video URL %s', async (url) => {
    const submit = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    render(<YouTubeUrlInput open onOpenChange={close} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: url } });
    fireEvent.change(screen.getByLabelText('Preferred transcript language'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(url, 'fr'));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });
  it('rejects deceptive hostnames and keeps a failed retry open with its URL', async () => {
    const submit = vi.fn().mockResolvedValue(false);
    const close = vi.fn();
    render(<YouTubeUrlInput open onOpenChange={close} onSubmit={submit} />);
    const input = screen.getByLabelText('YouTube video URL');
    fireEvent.change(input, { target: { value: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ' } });
    expect(screen.getByRole('button', { name: 'Invalid URL' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    await waitFor(() => expect(limits.refreshStatus).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveValue('https://youtu.be/dQw4w9WgXcQ');
  });
});
