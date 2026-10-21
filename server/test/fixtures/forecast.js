// Minimal OpenWeatherMap 5-day/3-hour forecast response.
// timezone 7200 (UTC+2, e.g. Zagreb in summer). dt values are unix seconds UTC.
// 2026-08-07 23:00 UTC is 2026-08-08 01:00 LOCAL — proves local-date bucketing.
const HOUR = 3600;
const BASE = Date.UTC(2026, 7, 7, 11, 0, 0) / 1000; // 2026-08-07 11:00 UTC

function entry(dtOffsetHours, temp, main, description, pop, wind) {
  return {
    dt: BASE + dtOffsetHours * HOUR,
    main: { temp },
    weather: [{ main, description }],
    pop,
    wind: { speed: wind },
  };
}

export function makeForecast() {
  return {
    city: {
      name: 'Zagreb',
      country: 'HR',
      timezone: 7200,
      coord: { lat: 45.81, lon: 15.98 },
    },
    list: [
      // Aug 7 local: 13:00, 16:00, 19:00
      entry(0, 24.2, 'Clouds', 'scattered clouds', 0.1, 3.2),
      entry(3, 27.8, 'Clear', 'clear sky', 0, 2.1),
      entry(6, 22.4, 'Clear', 'clear sky', 0, 4.7),
      // Aug 7 23:00 UTC → Aug 8 01:00 LOCAL (the timezone trap)
      entry(12, 18.1, 'Rain', 'light rain', 0.6, 5.5),
      // Aug 8 local: 07:00, 13:00
      entry(18, 16.9, 'Rain', 'moderate rain', 0.9, 6.0),
      entry(24, 19.5, 'Rain', 'light rain', 0.4, 3.9),
    ],
  };
}
