export const providerKycInstructions=`Read only the visible front side of a Vietnamese citizen identity card (CCCD).
Return the strict JSON schema. Extract only full_name, identity_number, date_of_birth, sex, nationality, expiry_date and address.
Never infer, repair or invent missing characters. Use null and confidence 0 for absent or unreadable values.
Set documentReadable=false when the whole card is not visible, is too blurred, too dark or has glare that prevents reliable reading.
Confidence is extraction confidence, never identity verification. Do not decide whether the document or person is authentic.`;
