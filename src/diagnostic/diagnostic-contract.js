export const diagnosticCategories = Object.freeze([
  'electricity', 'plumbing', 'air-conditioning', 'appliances',
]);

const isPlainObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function validateAiDiagnostic(value) {
  if (!isPlainObject(value)) throw new TypeError('Invalid AI diagnostic response');
  const keys = Object.keys(value).sort();
  const expected = ['confidence', 'missingQuestions', 'serviceCategory', 'understoodProblem', 'vietnameseSummary'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Invalid AI diagnostic response');
  }
  if (!diagnosticCategories.includes(value.serviceCategory)
      || typeof value.understoodProblem !== 'string' || !value.understoodProblem.trim() || value.understoodProblem.length > 500
      || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
      || !Array.isArray(value.missingQuestions) || value.missingQuestions.length > 3
      || value.missingQuestions.some(question => typeof question !== 'string' || !question.trim() || question.length > 300)
      || typeof value.vietnameseSummary !== 'string' || !value.vietnameseSummary.trim() || value.vietnameseSummary.length > 500) {
    throw new TypeError('Invalid AI diagnostic response');
  }
  return Object.freeze({
    serviceCategory: value.serviceCategory,
    understoodProblem: value.understoodProblem.trim(),
    confidence: value.confidence,
    missingQuestions: Object.freeze(value.missingQuestions.map(question => question.trim())),
    vietnameseSummary: value.vietnameseSummary.trim(),
  });
}

export function adaptAiDiagnostic(value) {
  const result = validateAiDiagnostic(value);
  return Object.freeze({
    categoryId: result.serviceCategory,
    summary: result.vietnameseSummary,
    understoodProblem: result.understoodProblem,
    confidence: result.confidence,
    missingQuestions: result.missingQuestions,
    source: 'openai',
  });
}
