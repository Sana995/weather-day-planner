import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App.jsx';
import { getWeather, streamLlm } from '../api.js';

vi.mock('../api.js', () => ({
  getWeather: vi.fn(),
  streamLlm: vi.fn(),
}));

describe('App', () => {
  it('renders the title and the day form', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /personal weather assistant/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/city/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get recommendations/i })).toBeInTheDocument();
  });
});

describe('App day mode', () => {
  it('renders weather then streams the recommendation', async () => {
    const user = userEvent.setup();
    getWeather.mockResolvedValue({
      city: { name: 'Zagreb', country: 'HR' },
      day: { date: '2026-08-08', tempMin: 16.9, tempMax: 19.5, condition: 'Rain',
             description: 'moderate rain', pop: 90, windMax: 6, entries: [] },
    });
    streamLlm.mockImplementation(async (path, body, { onToken, onDone }) => {
      onToken('### Outfit\n');
      onToken('- Raincoat');
      onDone?.();
    });

    render(<App />);
    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));

    expect(await screen.findByText(/Zagreb, HR/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Outfit' })).toBeInTheDocument();
    expect(document.querySelector('.error')).toBeNull();
    expect(streamLlm).toHaveBeenCalledWith('/api/recommend',
      expect.objectContaining({ city: 'Zagreb' }), expect.any(Object));
  });

  it('shows API errors inline', async () => {
    const user = userEvent.setup();
    getWeather.mockRejectedValue(new Error('City not found'));
    render(<App />);
    await user.type(screen.getByLabelText(/city/i), 'Xyzzyville');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));
    expect(await screen.findByText('City not found')).toBeInTheDocument();
  });

  it('disables the submit button while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolveStream;
    streamLlm.mockImplementation(() => new Promise(resolve => {
      resolveStream = resolve;
    }));
    getWeather.mockResolvedValue({
      city: { name: 'Paris', country: 'FR' },
      day: { date: '2026-08-08', tempMin: 16, tempMax: 22, condition: 'Sunny',
             description: 'clear skies', pop: 0, windMax: 3, entries: [] },
    });

    render(<App />);
    await user.type(screen.getByLabelText(/city/i), 'Paris');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));

    expect(screen.getByRole('button', { name: /get recommendations/i })).toBeDisabled();

    await act(async () => {
      resolveStream();
    });
  });

  it('shows the Sunny chat panel only after a recommendation finishes', async () => {
    const user = userEvent.setup();
    getWeather.mockResolvedValue({
      city: { name: 'Zagreb', country: 'HR' },
      day: { date: '2026-08-08', tempMin: 16, tempMax: 19, condition: 'Rain',
             description: 'rain', pop: 90, windMax: 6, entries: [] },
    });
    streamLlm.mockImplementation(async (path, body, { onToken }) => onToken('### Outfit\nShell jacket'));

    render(<App />);
    expect(screen.queryByLabelText(/chat with sunny/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/city/i), 'Zagreb');
    await user.click(screen.getByRole('button', { name: /get recommendations/i }));

    expect(await screen.findByLabelText(/chat with sunny/i)).toBeInTheDocument();
  });
});
