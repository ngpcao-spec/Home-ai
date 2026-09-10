export const providerPricingModels = ['hourly', 'daily', 'fixed', 'per_unit', 'rental_daily', 'quote'] as const;

export const providerActivitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceCategory', 'activityName', 'description', 'pricingModel'],
  properties: {
    serviceCategory: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,79}$' },
    activityName: { type: 'string', minLength: 2, maxLength: 120 },
    description: { type: 'string', minLength: 2, maxLength: 500 },
    pricingModel: { type: 'string', enum: providerPricingModels },
  },
} as const;

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);

export function validateProviderActivityRequest(value: unknown) {
  if (!plainObject(value) || Object.keys(value).some(key => !['inputMode', 'text'].includes(key))) {
    throw new Error('INVALID_INPUT');
  }
  const inputMode = value.inputMode;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!['profession', 'description'].includes(String(inputMode)) || text.length < 2 || text.length > 1000) {
    throw new Error('INVALID_INPUT');
  }
  return { inputMode: inputMode as 'profession' | 'description', text };
}

export function validateProviderActivity(value: unknown) {
  if (!plainObject(value)) throw new Error('AI_INVALID_RESPONSE');
  const expected = ['activityName', 'description', 'pricingModel', 'serviceCategory'];
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('AI_INVALID_RESPONSE');
  }
  const serviceCategory = typeof value.serviceCategory === 'string' ? value.serviceCategory.trim().toLowerCase() : '';
  const activityName = typeof value.activityName === 'string' ? value.activityName.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(serviceCategory)
      || activityName.length < 2 || activityName.length > 120
      || description.length < 2 || description.length > 500
      || !providerPricingModels.includes(value.pricingModel as typeof providerPricingModels[number])) {
    throw new Error('AI_INVALID_RESPONSE');
  }
  return { serviceCategory, activityName, description,
    pricingModel: value.pricingModel as typeof providerPricingModels[number] };
}
