export const categories = ['electricity', 'plumbing', 'air-conditioning', 'appliances'] as const;

export const diagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceCategory', 'understoodProblem', 'confidence', 'missingQuestions', 'vietnameseSummary'],
  properties: {
    serviceCategory: { type: 'string', enum: categories },
    understoodProblem: { type: 'string', minLength: 1, maxLength: 500 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missingQuestions: {
      type: 'array', maxItems: 3, items: {
        type: 'object', additionalProperties: false,
        required: ['question', 'suggestedAnswers', 'allowUnknown'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 300 },
          suggestedAnswers: {
            type: 'array', minItems: 3, maxItems: 5,
            items: { type: 'string', minLength: 1, maxLength: 120 },
          },
          allowUnknown: { type: 'boolean' },
        },
      },
    },
    vietnameseSummary: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const;

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);

export function validateRequest(value: unknown) {
  if (!plainObject(value) || Object.keys(value).some(key => !['description', 'preferredCategory', 'clarifications'].includes(key))) {
    throw new Error('INVALID_INPUT');
  }
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const preferredCategory = value.preferredCategory == null ? null : String(value.preferredCategory);
  const rawClarifications = value.clarifications ?? [];
  if (!description || description.length > 2000
      || (preferredCategory !== null && !categories.includes(preferredCategory as typeof categories[number]))
      || !Array.isArray(rawClarifications) || rawClarifications.length > 3) {
    throw new Error('INVALID_INPUT');
  }
  const clarifications = rawClarifications.map(item => {
    if (!plainObject(item) || Object.keys(item).some(key => !['question', 'answer'].includes(key))) throw new Error('INVALID_INPUT');
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    if (!question || question.length > 300 || !answer || answer.length > 500) throw new Error('INVALID_INPUT');
    return { question, answer };
  });
  return { description, preferredCategory, clarifications };
}

export function validateDiagnostic(value: unknown) {
  if (!plainObject(value)) throw new Error('AI_INVALID_RESPONSE');
  const expected = ['confidence', 'missingQuestions', 'serviceCategory', 'understoodProblem', 'vietnameseSummary'].sort();
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('AI_INVALID_RESPONSE');
  if (!categories.includes(value.serviceCategory as typeof categories[number])
      || typeof value.understoodProblem !== 'string' || !value.understoodProblem.trim() || value.understoodProblem.length > 500
      || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
      || !Array.isArray(value.missingQuestions) || value.missingQuestions.length > 3
      || typeof value.vietnameseSummary !== 'string' || !value.vietnameseSummary.trim() || value.vietnameseSummary.length > 500) {
    throw new Error('AI_INVALID_RESPONSE');
  }
  const missingQuestions = value.missingQuestions.map(item => {
    if (!plainObject(item)) throw new Error('AI_INVALID_RESPONSE');
    const expectedQuestionKeys = ['allowUnknown', 'question', 'suggestedAnswers'];
    const itemKeys = Object.keys(item).sort();
    if (itemKeys.length !== expectedQuestionKeys.length || itemKeys.some((key, index) => key !== expectedQuestionKeys[index])) throw new Error('AI_INVALID_RESPONSE');
    if (typeof item.question !== 'string' || !item.question.trim() || item.question.length > 300
        || !Array.isArray(item.suggestedAnswers) || item.suggestedAnswers.length < 3 || item.suggestedAnswers.length > 5
        || item.suggestedAnswers.some(answer => typeof answer !== 'string' || !answer.trim() || answer.length > 120 || ['Khác', 'Không biết'].includes(answer.trim()))
        || new Set(item.suggestedAnswers.map(answer => answer.trim())).size !== item.suggestedAnswers.length
        || typeof item.allowUnknown !== 'boolean') throw new Error('AI_INVALID_RESPONSE');
    return {
      question: item.question.trim(),
      suggestedAnswers: item.suggestedAnswers.map(answer => answer.trim()),
      allowUnknown: item.allowUnknown,
    };
  });
  return {
    serviceCategory: value.serviceCategory,
    understoodProblem: value.understoodProblem.trim(),
    confidence: value.confidence,
    missingQuestions,
    vietnameseSummary: value.vietnameseSummary.trim(),
  };
}
