import { render, screen } from '@testing-library/react';
import WeatherCard from '../components/WeatherCard.jsx';

const CITY = { name: 'Zagreb', country: 'HR' };
const DAY = {
  date: '2026-08-08', tempMin: 16.9, tempMax: 19.5, condition: 'Rain',
  description: 'moderate rain', pop: 90, windMax: 6,
  entries: [
    { time: '07:00', temp: 16.9, condition: 'Rain', description: 'moderate rain', pop: 0.9, wind: 6 },
    { time: '13:00', temp: 19.5, condition: 'Rain', description: 'light rain', pop: 0.4, wind: 3.9 },
  ],
};

describe('WeatherCard', () => {
  it('shows the headline summary', () => {
    render(<WeatherCard city={CITY} day={DAY} />);
    expect(screen.getByText(/Zagreb, HR/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-08/)).toBeInTheDocument();
    expect(screen.getByText(/16\.9.*19\.5/)).toBeInTheDocument();
    expect(screen.getByText((content, element) =>
      element.closest('.weather-summary') !== null && content === 'moderate rain'
    )).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
    expect(screen.getByText(/6 m\/s/)).toBeInTheDocument();
  });

  it('renders one slot per 3-hour entry', () => {
    render(<WeatherCard city={CITY} day={DAY} />);
    expect(screen.getByText('07:00')).toBeInTheDocument();
    expect(screen.getByText('13:00')).toBeInTheDocument();
  });
});
