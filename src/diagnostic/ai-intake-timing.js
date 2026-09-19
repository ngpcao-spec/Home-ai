// Opt-in, temporary timing only. Never record the request, response, user ID or token.
export function createAiIntakeTiming({
  enabled = new URLSearchParams(globalThis.location?.search ?? '').has('ai_timing'),
  now = () => globalThis.performance.now(),
  logger = event => globalThis.console?.info?.('[HOME AI AI timing]', event),
} = {}) {
  let startedAt = null;
  let firstQuestionMarked = false;
  let runId = 0;
  const mark = stage => {
    if (!enabled || startedAt === null) return;
    logger({ stage, elapsedMs: Math.round(now() - startedAt) });
  };
  return Object.freeze({
    start() {
      if (!enabled) return null;
      runId += 1;
      startedAt = now();
      firstQuestionMarked = false;
      mark('click');
      return runId;
    },
    mark,
    firstQuestionRendered(expectedRunId) {
      if (expectedRunId !== runId || firstQuestionMarked) return;
      firstQuestionMarked = true;
      mark('first_question_rendered');
    },
  });
}

