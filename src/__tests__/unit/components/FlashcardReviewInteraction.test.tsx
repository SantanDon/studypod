import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FlashcardView from '@/components/notebook/FlashcardView';
import type { Flashcard } from '@/types/flashcard';

const cards: Flashcard[] = [1, 2, 3].map(number => ({
  id: `card-${number}`, front: `Question ${number}`, back: `Answer ${number}`,
  sourceId: 'cedar', sourceTitle: 'Cedar', cardType: 'fact', difficulty: 'easy',
  lastReviewed: null, nextReview: null, correctCount: 0, incorrectCount: 0,
  easeFactor: 2.5, interval: 0,
}));
afterEach(cleanup);

it.each(['Enter', ' '])('reveals the answer with the %j key', async key => {
  render(<FlashcardView cards={cards} deckId="deck" onReview={vi.fn()} onClose={vi.fn()} />);
  const reveal = screen.getByRole('button', { name: 'Reveal answer' });
  expect(reveal).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(reveal, { key });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Easy' })).toBeVisible());
  expect(screen.queryByRole('button', { name: 'Reveal answer' })).not.toBeInTheDocument();
});

it('waits for a saved review, blocks duplicate ratings, and reviews every card', async () => {
  let acknowledge!: () => void;
  const onReview = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }))
    .mockResolvedValue(undefined);
  render(<FlashcardView cards={cards} deckId="deck" onReview={onReview} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Question 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Good' }));
  expect(screen.getByRole('button', { name: 'Good' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Good' }));
  expect(onReview).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Card 1 of 3')).toBeVisible();
  expect(screen.getByText('0 reviewed')).toBeVisible();
  await act(async () => acknowledge());
  for (const number of [2, 3]) {
    await waitFor(() => expect(screen.getByText(`Card ${number} of 3`)).toBeVisible());
    fireEvent.click(screen.getByText(`Question ${number}`));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(number));
  }
  await waitFor(() => expect(screen.getByText('Session Complete!')).toBeVisible());
  expect(onReview.mock.calls.map(call => call[1])).toEqual(['card-1', 'card-2', 'card-3']);
});

it('keeps the failed card available and advances only after a successful retry', async () => {
  const onReview = vi.fn().mockRejectedValueOnce(new Error('Connection lost. Retry review.')).mockResolvedValue(undefined);
  render(<FlashcardView cards={cards} deckId="deck" onReview={onReview} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Question 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connection lost. Retry review.'));
  expect(screen.getByText('Card 1 of 3')).toBeVisible();
  expect(screen.getByText('0 reviewed')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
  await waitFor(() => expect(screen.getByText('Card 2 of 3')).toBeVisible());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onReview.mock.calls.map(call => call[1])).toEqual(['card-1', 'card-1']);
});
