export default function WeatherCard({ city, day }) {
  return (
    <section className="card" aria-label="Weather summary">
      <div className="weather-summary">
        <div className="weather-place">
          <strong>{city.name}, {city.country}</strong> — {day.date}
        </div>
        <span className="temp">{day.tempMin}–{day.tempMax}<span className="unit"> °C</span></span>
        <span className="desc">{day.description}</span>
        <ul className="chip-row">
          {/* The chip reads its own value: the fill runs to --pop percent. */}
          <li className="chip chip-blue chip-meter" style={{ '--pop': day.pop }}>rain {day.pop}%</li>
          <li className="chip chip-mint">wind up to {day.windMax} m/s</li>
        </ul>
      </div>
      <div className="hourly" tabIndex={0} role="group" aria-label="Three-hourly forecast">
        {day.entries.map((e) => {
          const pop = Math.round((e.pop ?? 0) * 100);
          return (
            <div className="slot" key={e.time}>
              <div className="slot-time">{e.time}</div>
              <strong>{Math.round(e.temp)} °C</strong>
              <div className="slot-desc">{e.description}</div>
              {/* Rain chance for this slot: a fill on a hatched track for the
                  eye scanning the strip, the same number in words for anyone
                  who cannot see it. */}
              <div className="slot-rain" aria-hidden="true">
                <span style={{ '--pop': pop }} />
              </div>
              <span className="sr-only">rain chance {pop} percent</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
