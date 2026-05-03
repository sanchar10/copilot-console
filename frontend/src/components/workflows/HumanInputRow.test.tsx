import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HumanInputRow } from './WorkflowRunView';

interface RunEventFixture {
  type: 'human_input_required';
  request_id: string;
  request_type?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  [k: string]: unknown;
}

function makeEvent(overrides: Partial<RunEventFixture>): RunEventFixture {
  return {
    type: 'human_input_required',
    request_id: 'req-1',
    ...overrides,
  };
}

describe('HumanInputRow', () => {
  it('renders confirmation kind with default labels and submits true on Approve', async () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'confirmation',
          message: 'Proceed?',
          metadata: {},
        })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    expect(screen.getByText('Proceed?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', true);
  });

  it('renders custom yes/no labels for confirmation', () => {
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'confirmation',
          metadata: { yes_label: 'Ship it', no_label: 'Hold' },
        })}
        onSubmit={vi.fn()}
        isSubmitted={false}
      />
    );
    expect(screen.getByRole('button', { name: /Ship it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold/i })).toBeInTheDocument();
  });

  it('confirmation Reject sends false', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({ request_type: 'confirmation', metadata: {} })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', false);
  });

  it('renders question with choice buttons and submits the choice value', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'question',
          message: 'Pick one',
          metadata: {
            choices: [
              { value: 'a', label: 'Apple' },
              { value: 'b', label: 'Banana' },
            ],
            allow_free_text: false,
          },
        })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Banana' }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', 'b');
  });

  it('renders question free-text field when no choices', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({ request_type: 'question', metadata: {} })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    const input = screen.getByPlaceholderText(/Type your answer/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', 'hello world');
  });

  it('renders user_input textarea and submits its value', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'user_input',
          metadata: { timeout_seconds: 30 },
        })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    expect(screen.getByText(/Timeout: 30s/i)).toBeInTheDocument();
    const ta = screen.getByPlaceholderText(/Provide input/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'multi\nline' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', 'multi\nline');
  });

  it('renders external schema form when required_fields present', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'external',
          metadata: { required_fields: ['name', 'role'] },
        })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'role' }), {
      target: { value: 'eng' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', {
      value: { name: 'Alice', role: 'eng' },
    });
  });

  it('renders external raw JSON textarea fallback when no required_fields', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({
          request_type: 'external',
          metadata: {},
        })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    const ta = screen.getByPlaceholderText(/JSON/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"x": 1}' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', { x: 1 });
  });

  it('external raw JSON falls back to string when input is not valid JSON', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({ request_type: 'external', metadata: {} })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );

    const ta = screen.getByPlaceholderText(/JSON/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'not-json' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', 'not-json');
  });

  it('disables all controls and shows "Response submitted" when isSubmitted', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({ request_type: 'confirmation', metadata: {} })}
        onSubmit={onSubmit}
        isSubmitted
      />
    );

    expect(screen.getByText(/Response submitted/i)).toBeInTheDocument();
    // Once submitted, input controls are hidden entirely (not rendered-and-disabled),
    // which guarantees the user cannot trigger a second submit for the same prompt.
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('falls back to confirmation when request_type is missing', () => {
    const onSubmit = vi.fn();
    render(
      <HumanInputRow
        event={makeEvent({ metadata: {}, message: 'legacy' })}
        onSubmit={onSubmit}
        isSubmitted={false}
      />
    );
    expect(screen.getByText('legacy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(onSubmit).toHaveBeenCalledWith('req-1', true);
  });
});
