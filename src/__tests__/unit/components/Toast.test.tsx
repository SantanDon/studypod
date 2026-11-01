import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  Toast, ToastAction, ToastClose, ToastDescription,
  ToastProvider, ToastTitle, ToastViewport,
} from '@/components/ui/toast';

describe('Retry notification', () => {
  const renderNotification = (onRetry = vi.fn()) => render(
    <ToastProvider>
      <Toast defaultOpen duration={Infinity} variant="destructive">
        <div>
          <ToastTitle>AI Temporarily Unavailable</ToastTitle>
          <ToastDescription>Your draft is still available. Retry shortly.</ToastDescription>
        </div>
        <ToastAction altText="Retry sending message" onClick={onRetry}>Retry</ToastAction>
        <ToastClose />
      </Toast>
      <ToastViewport />
    </ToastProvider>,
  );

  it('lets the user dismiss a failure notification without retrying', () => {
    const onRetry = vi.fn();
    renderNotification(onRetry);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps the retry action available', () => {
    const onRetry = vi.fn();
    renderNotification(onRetry);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
