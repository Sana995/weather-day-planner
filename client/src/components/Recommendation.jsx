import Markdown from 'react-markdown';
import ProfileChips from './ProfileChips.jsx';

// Models sometimes emit GFM task syntax ("- [ ] sunscreen"), but no GFM
// plugin is installed, so CommonMark would render the brackets as literal text
// next to the soft checkbox the list item already draws. Strip the marker and
// let the box do its job.
const TASK_MARKER = /^([ \t]*[-*+][ \t]+)\[[ xX]\][ \t]+/gm;

export default function Recommendation({ text, streaming, profile }) {
  if (!text && !streaming) return null;
  return (
    <section className="card recommendation" aria-label="Recommendation">
      <ProfileChips profile={profile} />
      {/* The markdown lives in its own box so the chip row above it keeps the
          chip vocabulary instead of inheriting the answer's list styling. */}
      <div className="answer">
        <Markdown>{text.replace(TASK_MARKER, '$1')}</Markdown>
        {streaming && <span className="cursor" aria-hidden="true" />}
      </div>
    </section>
  );
}
