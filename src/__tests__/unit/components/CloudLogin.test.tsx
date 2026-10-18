import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudLogin } from '@/components/auth/CloudLogin';

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signInWithCloud: vi.fn(), signup: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...mocks, error: null, mfaRequired: false, verifyMfa: vi.fn() }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { signup: mocks.signup } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function credentials() {
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'fixture@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-test-password' } });
}

describe('cloud account transitions', () => {
  it('opens the workspace after cookie-authenticated signup without asking for nonexistent verification', async () => {
    const user = { id: 'fixture', email: 'fixture@example.test', createdAt: '2026-10-12' };
    mocks.signup.mockResolvedValue({ user });
    const onSuccess = vi.fn();
    render(<CloudLogin initialIsSignUp onSuccess={onSuccess} />);
    credentials();
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'QA Fixture' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mocks.signInWithCloud).toHaveBeenCalledWith(user);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Your study workspace is ready.' }));
  });

  it.each([false, 'failure'])('keeps the login open for an MFA challenge or rejected credentials (%s)', async (result) => {
    if (result === 'failure') mocks.signIn.mockRejectedValue(new Error('Invalid credentials'));
    else mocks.signIn.mockResolvedValue(false);
    const onSuccess = vi.fn();
    render(<CloudLogin onSuccess={onSuccess} />);
    credentials();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    expect(onSuccess).not.toHaveBeenCalled();
    if (result === 'failure') expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Login Failed' }));
  });
});
