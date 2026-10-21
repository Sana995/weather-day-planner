// Single source of truth for profile enums — imported by server validation
// and the client UI via the "@weather/shared" workspace.
export const PROFILE_OPTIONS = {
  activity: ['everyday', 'office', 'running & sports', 'hiking', 'outdoors', 'tourism'],
  coldTolerance: ['runs cold', 'average', 'runs warm'],
  heatTolerance: ['sensitive to heat', 'average', 'handles heat well'],
};

export const DEFAULT_PROFILE = { activity: 'everyday', coldTolerance: 'average', heatTolerance: 'average' };
