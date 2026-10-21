import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import WeatherForm from '../components/WeatherForm.jsx';
import { isoDaysFromToday } from '../dates.js';

describe('WeatherForm', () => {
  it('constrains the date input to today through +5 days', () => {
    render(<WeatherForm onSubmit={() => {}} busy={false} />);
    const date = screen.getByLabelText(/date/i);
    expect(date).toHaveAttribute('min', isoDaysFromToday(0));
    expect(date).toHaveAttribute('max', isoDaysFromToday(5));
  });

  it('submits city, date, and profile', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<WeatherForm onSubmit={onSubmit} busy={false} />);

    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    const date = screen.getByLabelText(/date/i);
    await user.clear(date);
    await user.type(date, isoDaysFromToday(1));
    await user.selectOptions(screen.getByLabelText('Activity'), 'tourism');
    await user.selectOptions(screen.getByLabelText(/cold tolerance/i), 'runs cold');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      city: 'Zagreb',
      date: isoDaysFromToday(1),
      profile: { activity: 'tourism', coldTolerance: 'runs cold', heatTolerance: 'average' },
      traveling: false,
      includeActivities: true,
    });
  });

  it('disables the submit button while busy', () => {
    render(<WeatherForm onSubmit={() => {}} busy={true} />);
    expect(screen.getByRole('button', { name: /get recommendations/i })).toBeDisabled();
  });

  it('keeps attractions independently selectable when activity ideas are off', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<WeatherForm onSubmit={onSubmit} busy={false} />);

    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ includeActivities: true }));

    await user.click(screen.getByRole('checkbox', { name: /activity ideas/i }));
    const attractions = screen.getByRole('checkbox', { name: /local attractions/i });
    expect(attractions).toBeEnabled();
    await user.click(attractions);
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeActivities: false, traveling: true }),
    );
  });

  it('submits traveling=false by default and true when checked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<WeatherForm onSubmit={onSubmit} busy={false} />);

    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ traveling: false }));

    await user.click(screen.getByRole('checkbox', { name: /local attractions/i }));
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ traveling: true }));
  });
});
