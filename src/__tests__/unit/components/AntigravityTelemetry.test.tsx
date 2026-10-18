import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AntigravityTelemetry from '@/components/agent/AntigravityTelemetry';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([true, false])('leaves notebook controls unobstructed without opt-in (development: %s)', development => {
  vi.stubEnv('DEV', development);
  vi.stubEnv('VITE_AGENT_TELEMETRY', '');
  const fetchPulse = vi.fn();
  vi.stubGlobal('fetch', fetchPulse);
  const { container } = render(<AntigravityTelemetry />);
  expect(container).toBeEmptyDOMElement();
  expect(fetchPulse).not.toHaveBeenCalled();
});

it('never enables internal telemetry in production even with opt-in', () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_AGENT_TELEMETRY', 'true');
  const fetchPulse = vi.fn();
  vi.stubGlobal('fetch', fetchPulse);
  const { container } = render(<AntigravityTelemetry />);
  expect(container).toBeEmptyDOMElement();
  expect(fetchPulse).not.toHaveBeenCalled();
});

it('allows developers to opt in locally', () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AGENT_TELEMETRY', 'true');
  const fetchPulse = vi.fn().mockResolvedValue({ json: async () => ({ success: false }) });
  vi.stubGlobal('fetch', fetchPulse);
  render(<AntigravityTelemetry />);
  expect(screen.getByRole('button', { name: 'Open developer telemetry' })).toBeVisible();
  expect(fetchPulse).toHaveBeenCalledWith('/api/agent/antigravity/pulse');
});
