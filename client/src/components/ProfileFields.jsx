import { PROFILE_OPTIONS, DEFAULT_PROFILE } from '@weather/shared';

// Re-export so form components keep one local import site for profile enums.
export { PROFILE_OPTIONS, DEFAULT_PROFILE };

// Exported so the chip row that restates the submitted profile reads its
// labels from the same place the form does.
export const PROFILE_LABELS = { activity: 'Activity', coldTolerance: 'Cold tolerance', heatTolerance: 'Heat tolerance' };

export default function ProfileFields({ profile, onChange }) {
  return (
    <div className="field-row profile-row">
      {Object.entries(PROFILE_OPTIONS).map(([field, options]) => (
        <div className="field" key={field}>
          <label htmlFor={`profile-${field}`}>{PROFILE_LABELS[field]}</label>
          <select
            id={`profile-${field}`}
            value={profile[field]}
            onChange={(e) => onChange({ ...profile, [field]: e.target.value })}
          >
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
