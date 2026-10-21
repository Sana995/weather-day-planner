import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App.jsx';
import ProfileChips from '../components/ProfileChips.jsx';
import { getWeather, streamLlm } from '../api.js';

vi.mock('../api.js', () => ({
  getWeather: vi.fn(),
  streamLlm: vi.fn(),
}));

const CHIP_ROW = { name: /profile this advice was written for/i };

describe('ProfileChips', () => {
  it('states the three profile answers', () => {
    render(<ProfileChips profile={{ activity: 'tourism', coldTolerance: 'runs cold', heatTolerance: 'handles heat well' }} />);
    const row = screen.getByRole('list', CHIP_ROW);
    expect(within(row).getByText('tourism')).toBeInTheDocument();
    expect(within(row).getByText('runs cold')).toBeInTheDocument();
    expect(within(row).getByText('handles heat well')).toBeInTheDocument();
  });

  it('renders nothing without a profile', () => {
    const { container } = render(<ProfileChips profile={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('App profile chips', () => {
  it('shows the submitted profile with the day recommendation', async () => {
    const user = userEvent.setup();
    getWeather.mockResolvedValue({
      city: { name: 'Zagreb', country: 'HR' },
      day: { date: '2026-08-08', tempMin: 16, tempMax: 19, condition: 'Rain',
             description: 'rain', pop: 90, windMax: 6, entries: [] },
    });
    streamLlm.mockImplementation(async (path, body, { onToken, onDone }) => {
      onToken('### Outfit\n- Raincoat');
      onDone?.();
    });

    render(<App />);
    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    await user.selectOptions(screen.getByLabelText('Activity'), 'tourism');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));

    const row = await screen.findByRole('list', CHIP_ROW);
    expect(within(row).getByText('tourism')).toBeInTheDocument();
    // Both tolerance fields default to 'average' — one chip each.
    expect(within(row).getAllByText('average')).toHaveLength(2);
  });
});
