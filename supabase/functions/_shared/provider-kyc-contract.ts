export const kycFieldNames = ['full_name','identity_number','date_of_birth','sex','nationality','expiry_date','address'] as const;
const nullableField = { type: 'object', additionalProperties: false, required: ['value','confidence'], properties: {
  value: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
}} as const;
export const providerKycSchema = { type: 'object', additionalProperties: false,
  required: ['documentReadable','fields'], properties: {
    documentReadable: { type: 'boolean' }, fields: { type: 'object', additionalProperties: false,
      required: kycFieldNames, properties: Object.fromEntries(kycFieldNames.map(name => [name, nullableField])) },
  } } as const;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function validateProviderKycRequest(value: unknown, providerId: string) {
  if(!object(value))throw new Error('INVALID_INPUT');
  if(Object.keys(value).length===1&&typeof value.documentPath==='string'
    &&new RegExp(`^provider/${providerId}/identity/front/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp|heic|heif)$`).test(value.documentPath))return {kind:'stored' as const,documentPath:value.documentPath};
  const allowedTypes=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  if(Object.keys(value).sort().join(',')!=='contentType,imageBase64,testPreview'||value.testPreview!==true
    ||typeof value.contentType!=='string'||!allowedTypes.includes(value.contentType)
    ||typeof value.imageBase64!=='string'||value.imageBase64.length<4||value.imageBase64.length>11184812
    ||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64))throw new Error('INVALID_INPUT');
  return {kind:'test-preview' as const,contentType:value.contentType,imageBase64:value.imageBase64};
}
export function validateProviderKycExtraction(value: unknown) {
  if(!object(value)||typeof value.documentReadable!=='boolean'||!object(value.fields)
    ||Object.keys(value).sort().join(',')!=='documentReadable,fields'
    ||Object.keys(value.fields).sort().join(',')!==[...kycFieldNames].sort().join(',')) throw new Error('AI_INVALID_RESPONSE');
  const fields:Record<string,{value:string|null;confidence:number}>={};
  for(const name of kycFieldNames){const field=value.fields[name];if(!object(field)||Object.keys(field).sort().join(',')!=='confidence,value'
    ||!(field.value===null||typeof field.value==='string')||String(field.value??'').length>500
    ||typeof field.confidence!=='number'||field.confidence<0||field.confidence>1)throw new Error('AI_INVALID_RESPONSE');
    fields[name]={value:field.value===null?null:field.value.trim()||null,confidence:field.value===null?0:field.confidence};}
  if(!value.documentReadable)for(const name of kycFieldNames)fields[name]={value:null,confidence:0};
  return {documentReadable:value.documentReadable,fields};
}
