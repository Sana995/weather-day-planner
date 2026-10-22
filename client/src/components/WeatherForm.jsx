import { useState } from 'react';
import ProfileFields, { DEFAULT_PROFILE } from './ProfileFields.jsx';
import { isoDaysFromToday } from '../dates.js';

export default function WeatherForm({ onSubmit, busy }) {
  const [city, setCity] = useState('');
  const [date, setDate] = useState(isoDaysFromToday(0));
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [traveling, setTraveling] = useState(false);
  const [includeActivities, setIncludeActivities] = useState(true);

  function handleSubmit(e) {
    e.preventDefault();
    // Independent flags: with activities off, attractions get their own
    // "### Attractions" section instead of riding inside Activities.
    onSubmit({ city: city.trim(), date, profile, traveling, includeActivities });
  }

  return (
    <form className="card panel" onSubmit={handleSubmit}>
      <h2 className="card-title">Plan your day</h2>
      <div className="field-row">
        <div className="field">
          <label htmlFor="city">City</label>
          {/* maxLength mirrors the server's 100-character city cap (validate.js). */}
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Zagreb" maxLength={100} required />
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date}
            min={isoDaysFromToday(0)} max={isoDaysFromToday(5)}
            onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <ProfileFields profile={profile} onChange={setProfile} />
      <label className="field-check">
        <input type="checkbox" checked={includeActivities}
          onChange={(e) => setIncludeActivities(e.target.checked)} />
        Include activity ideas
      </label>
      <label className="field-check">
        <input type="checkbox" checked={traveling}
          onChange={(e) => setTraveling(e.target.checked)} />
        Include local attractions
      </label>
      <div className="form-submit">
        <button className="primary" type="submit" disabled={busy}>Get recommendations</button>
        {busy && <span className="form-progress" aria-hidden="true" />}
      </div>
    </form>
  );
}
