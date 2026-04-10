import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Charlie' },
];

describe('Dropdown', () => {
  it('renders the selected option label', () => {
    render(<Dropdown options={options} value="b" onChange={vi.fn()} />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders placeholder when no value selected', () => {
    render(<Dropdown options={options} value="" onChange={vi.fn()} placeholder="Pick one" />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Dropdown options={options} value="a" onChange={vi.fn()} label="Choose" />);
    expect(screen.getByText('Choose')).toBeInTheDocument();
  });

  it('opens dropdown on click', () => {
    render(<Dropdown options={options} value="a" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Alpha'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('does not open when disabled', () => {
    render(<Dropdown options={options} value="a" onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByText('Alpha'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onChange when an option is clicked', () => {
    const onChange = vi.fn();
    render(<Dropdown options={options} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('Charlie'));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('closes dropdown after selection', () => {
    render(<Dropdown options={options} value="a" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('Beta'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('highlights the selected option', () => {
    render(<Dropdown options={options} value="b" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Beta'));
    const selectedOption = screen.getByRole('option', { selected: true });
    expect(selectedOption).toHaveTextContent('Beta');
  });

  it('closes on Escape key', () => {
    render(<Dropdown options={options} value="a" onChange={vi.fn()} />);
    const trigger = screen.getByText('Alpha');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigates with arrow keys and selects with Enter', () => {
    const onChange = vi.fn();
    render(<Dropdown options={options} value="a" onChange={onChange} />);
    const trigger = screen.getByText('Alpha');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('shows tooltip on option when title is provided', () => {
    const opts = [{ value: 'x', label: 'Short', title: 'Full long path here' }];
    render(<Dropdown options={opts} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Select...'));
    expect(screen.getByTitle('Full long path here')).toBeInTheDocument();
  });

  it('renders empty state when no options', () => {
    render(<Dropdown options={[]} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Select...'));
    expect(screen.getByText('No options')).toBeInTheDocument();
  });
});
