import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import LiquidCitation from '@/components/chat/LiquidCitation';
import type { Citation } from '@/types/message';

afterEach(cleanup);

const citation = (sourceId: string, excerpt: string): Citation => ({
  citation_id: sourceId, source_id: sourceId, source_title: sourceId,
  source_type: 'text', excerpt, chunk_lines_from: 12, chunk_lines_to: 12,
});

describe('citation keyboard disclosure', () => {
  it('uses Enter and Space to open and close the correct excerpt without submitting its containing form', async () => {
    const user = userEvent.setup();
    let submissions = 0;
    render(<form onSubmit={(event) => { event.preventDefault(); submissions += 1; }}>
      <LiquidCitation citation={citation('Cedar source', 'Cedar has 17 blue trays.')} index={1} />
      <LiquidCitation citation={citation('Birch source', 'Birch has 9 green trays.')} index={1} />
    </form>);
    const [cedar, birch] = screen.getAllByRole('button', { name: 'Citation 1' });
    expect(cedar).toHaveAttribute('type', 'button');
    expect(cedar).toHaveAttribute('aria-expanded', 'false');
    const cedarId = cedar.getAttribute('aria-controls')!;
    const birchId = birch.getAttribute('aria-controls')!;
    expect(cedarId).not.toBe(birchId);
    await user.tab();
    expect(cedar).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(cedar).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.getElementById(cedarId)!).getByText('Cedar has 17 blue trays.')).toBeInTheDocument();
    expect(screen.queryByText('Birch has 9 green trays.')).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(cedar).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(document.getElementById(cedarId)).toBeNull());
    await user.tab();
    expect(birch).toHaveFocus();
    await user.keyboard(' ');
    expect(birch).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.getElementById(birchId)!).getByText('Birch has 9 green trays.')).toBeInTheDocument();
    expect(screen.queryByText('Cedar has 17 blue trays.')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(birch).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(document.getElementById(birchId)).toBeNull());
    expect(submissions).toBe(0);
  });
});
