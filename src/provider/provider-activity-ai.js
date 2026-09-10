const pricingModels = new Set(['hourly', 'daily', 'fixed', 'per_unit', 'rental_daily', 'quote']);

export function adaptProviderActivityProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_INVALID_RESPONSE');
  const keys = Object.keys(value).sort();
  const expected = ['activityName', 'description', 'pricingModel', 'serviceCategory'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('AI_INVALID_RESPONSE');
  }
  const serviceCategory = String(value.serviceCategory ?? '').trim().toLowerCase();
  const activityName = String(value.activityName ?? '').trim();
  const description = String(value.description ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(serviceCategory)
      || activityName.length < 2 || activityName.length > 120
      || description.length < 2 || description.length > 500
      || !pricingModels.has(value.pricingModel)) throw new Error('AI_INVALID_RESPONSE');
  return Object.freeze({ serviceCategory, activityName, description, pricingModel: value.pricingModel });
}

export async function analyzeProviderActivity(client, { inputMode, text }) {
  const cleanMode = String(inputMode ?? '');
  const cleanText = String(text ?? '').trim();
  if (!['profession', 'description'].includes(cleanMode) || cleanText.length < 2 || cleanText.length > 1000) {
    throw new TypeError('INVALID_INPUT');
  }
  const { data, error } = await client.functions.invoke('classify-provider-activity', {
    body: { inputMode: cleanMode, text: cleanText },
  });
  if (error) {
    const code = error?.context?.body?.error?.code ?? error?.code ?? 'AI_REQUEST_FAILED';
    throw Object.assign(new Error(code), { code });
  }
  return adaptProviderActivityProposal(data);
}
