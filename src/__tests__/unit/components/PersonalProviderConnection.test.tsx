import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalProviderConnection } from '@/components/settings/PersonalProviderConnection';
import { clearPersonalProviderConnection, getPersonalProviderRequestHeaders } from '@/lib/ai/personalProviderContext';

afterEach(() => {
  cleanup();
  clearPersonalProviderConnection();
  vi.unstubAllGlobals();
});

describe('PersonalProviderConnection', () => {
  it('tests with the explicit provider contract, clears the input, and disconnects the in-memory key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connected: true, provider: 'groq', model: 'llama-test' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PersonalProviderConnection />);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'groq-secret' } });
    fireEvent.change(screen.getByLabelText('Model (optional)'), { target: { value: 'llama-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    expect(await screen.findByText(/Groq connected · llama-test/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/provider/test', expect.objectContaining({
      method: 'POST', credentials: 'include', body: '{}',
      headers: expect.objectContaining({ 'X-StudyPod-Provider': 'groq', 'X-StudyPod-Api-Key': 'groq-secret', 'X-StudyPod-Model': 'llama-test' }),
    }));
    expect(getPersonalProviderRequestHeaders()['X-StudyPod-Api-Key']).toBe('groq-secret');

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(getPersonalProviderRequestHeaders()).toEqual({});
    expect(await screen.findByLabelText('API key')).toBeTruthy();
  });

  it('does not connect on test failure and redacts a key echoed by the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Rejected key groq-secret' }) }));
    render(<PersonalProviderConnection />);
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'groq-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toBe('Rejected key [redacted]'));
    expect(alert.textContent).not.toContain('groq-secret');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(getPersonalProviderRequestHeaders()).toEqual({});
  });
});
