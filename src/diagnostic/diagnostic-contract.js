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
      || typeof value.vietnameseSummary !== 'string' || !value.vietnameseSummary.trim() || value.vietnameseSummary.length > 500) {
    throw new TypeError('Invalid AI diagnostic response');
  }
  const missingQuestions = value.missingQuestions.map(item => {
    if (!isPlainObject(item)) throw new TypeError('Invalid AI diagnostic response');
    const itemKeys = Object.keys(item).sort();
    const expectedItemKeys = ['allowUnknown', 'question', 'suggestedAnswers'];
    if (itemKeys.length !== expectedItemKeys.length || itemKeys.some((key, index) => key !== expectedItemKeys[index])
        || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 300
        || !Array.isArray(item.suggestedAnswers) || item.suggestedAnswers.length < 3 || item.suggestedAnswers.length > 5
        || item.suggestedAnswers.some(answer => typeof answer !== 'string' || !answer.trim() || answer.length > 120 || ['Khác', 'Không biết'].includes(answer.trim()))
        || new Set(item.suggestedAnswers.map(answer => answer.trim())).size !== item.suggestedAnswers.length
        || typeof item.allowUnknown !== 'boolean') throw new TypeError('Invalid AI diagnostic response');
    return Object.freeze({
      question: item.question.trim(),
      suggestedAnswers: Object.freeze(item.suggestedAnswers.map(answer => answer.trim())),
      allowUnknown: item.allowUnknown,
    });
  });
  return Object.freeze({
    serviceCategory: value.serviceCategory,
    understoodProblem: value.understoodProblem.trim(),
    confidence: value.confidence,
    missingQuestions: Object.freeze(missingQuestions),
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
