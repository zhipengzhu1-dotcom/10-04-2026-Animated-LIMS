// The surface registry: where each Queue is shown and which sidebar badge counts it. A new Queue gets its surfaces
// in SURFACES and its badges in BADGES, or the coverage sweep in agreement.test.js fails. Each surface reads whether
// the signed-in person `c` sees the record there.

const listed = async (c, url, id) => (await c.ok('GET', url)).some((x) => x.id === id);
const onReviews = async (c, list, id) => (await c.ok('GET', '/api/reviews'))[list].some((x) => x.id === id);
export const inMyDrafts = async (c, e) => (await c.ok('GET', '/api/dashboard')).myDrafts.some((n) => n.id === e.id);
export const inNotebookDrafts = (c, e) => listed(c, '/api/notebook?work=drafts', e.id);
const workFilters = (work) => ({
  'Samples work filter': (c, t) => listed(c, `/api/samples?limit=2000&work=${work}`, t.sampleId),
  'Tests work filter': (c, t) => listed(c, `/api/tests?limit=3000&work=${work}`, t.testId),
});

// The surfaces showing each Queue, by Queue table. Each reads whether the signed-in person sees the record there.
export const SURFACES = {
  TEST_QUEUES: {
    assigned: { ...workFilters('assigned'), 'Worklist My tests': (c, t) => listed(c, '/api/tests?scope=open&limit=3000&work=assigned', t.testId) },
    review: { ...workFilters('review'), 'Reviews page review list': (c, t) => onReviews(c, 'toReview', t.testId) },
    approval: { ...workFilters('approval'), 'Reviews page approval list': (c, t) => onReviews(c, 'toApprove', t.testId) },
  },
  SAMPLE_QUEUES: {
    certificate: { 'Reviews page certificate list': (c, s) => onReviews(c, 'toIssue', s) },
  },
  ENTRY_QUEUES: {
    witness: { 'Reviews page witness list': (c, e) => onReviews(c, 'toWitness', e.id) },
    // A new draft is its author's most recent, so it is among the Dashboard's first five.
    drafts: { 'Dashboard My drafts': inMyDrafts, 'Notebook My drafts tab': inNotebookDrafts },
  },
};

// The Queues each sidebar badge counts, as [Queue table, Queue].
export const BADGES = {
  myTests: [['TEST_QUEUES', 'assigned']],
  reviews: [['TEST_QUEUES', 'review'], ['TEST_QUEUES', 'approval'], ['SAMPLE_QUEUES', 'certificate'], ['ENTRY_QUEUES', 'witness']],
};
