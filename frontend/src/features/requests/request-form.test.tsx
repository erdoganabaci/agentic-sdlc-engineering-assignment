import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestForm } from './request-form';

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<RequestForm standardRateBps={400} submitLabel="Submit" onSubmit={onSubmit} />);
  return onSubmit;
}

describe('RequestForm', () => {
  it('previews the resulting rate from integer basis points', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Discount (basis points)'), '25');
    expect(screen.getByText(/4\.00% − 0\.25% = 3\.75% resulting rate/)).toBeTruthy();
  });

  it('explains the valid range for an out-of-range discount', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Discount (basis points)'), '400');
    expect(screen.getByText(/enter a whole number from 1 to 399/)).toBeTruthy();
  });

  it('does not submit a whitespace-only reason', async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText('Discount (basis points)'), '25');
    await userEvent.type(screen.getByLabelText('Reason'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed-length-valid content and shows server errors', async () => {
    const onSubmit = renderForm(vi.fn().mockRejectedValue(new Error('Discount must be below the standard rate.')));
    await userEvent.type(screen.getByLabelText('Discount (basis points)'), '25');
    await userEvent.type(screen.getByLabelText('Reason'), 'Competing offer');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({ discountBps: 25, reason: 'Competing offer' });
    expect((await screen.findByRole('alert')).textContent).toContain('below the standard rate');
  });
});
