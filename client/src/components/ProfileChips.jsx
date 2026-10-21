import { PROFILE_OPTIONS, PROFILE_LABELS } from './ProfileFields.jsx';

// The three answers that shaped the advice, restated where the advice is read.
// Presentational only: it renders the profile that was submitted, in the same
// order the form asks for it, and never touches it.
export default function ProfileChips({ profile }) {
  if (!profile) return null;
  const fields = Object.keys(PROFILE_OPTIONS).filter((field) => profile[field]);
  if (fields.length === 0) return null;

  return (
    <ul className="chip-row profile-chips" aria-label="Profile this advice was written for">
      {fields.map((field) => (
        <li className="chip chip-profile" key={field}>
          <span className="chip-key">{PROFILE_LABELS[field]}</span>
          {profile[field]}
        </li>
      ))}
    </ul>
  );
}
