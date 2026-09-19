// This guard only identifies category-level requests with no concrete work or
// observable symptom. The AI still writes every clarification question.
const genericWords = new Set([
  'toi', 'minh', 'can', 'muon', 'tim', 'goi', 'thue', 'nho', 'cho', 'giup',
  'tho', 'nguoi', 'dich', 'vu', 'sua', 'chua', 'kiem', 'tra', 'bi', 'hong',
  'hu', 'mot', 'vai', 'nhieu', 'cai', 'chiec', 'bo', 'he', 'thong', 'trong',
  'nha', 'cua', 'toi', 'nay', 'do', 'gi', 've', 'phan', 'van', 'de',
]);

// Broad service names, rather than a fixed list of questions. Add another
// service's category-level nouns here when that service becomes available.
const broadServiceNames = [
  'dien gia dung', 'dieu hoa', 'may lanh', 'may giat', 'tu lanh',
  'ong nuoc', 'nuoc', 'dien',
];

const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function requiresIntakeClarification({ description, clarifications = [] }) {
  if (clarifications.length >= 3) return false;
  const knownText = [description, ...clarifications.map(item => item.answer)].map(normalize).join(' ');
  let remainder = ` ${knownText.replace(/\b(?:khong biet|khong ro|chua biet|chua ro)\b/g, ' ')} `;
  for (const service of broadServiceNames) remainder = remainder.replaceAll(` ${service} `, ' ');
  const meaningful = remainder.trim().split(/\s+/).filter(word => word
    && !genericWords.has(word) && !/^\d+$/.test(word));
  return meaningful.length === 0;
}

export async function enforceIntakeCompleteness({ input, diagnostic, retry }) {
  if (!requiresIntakeClarification(input) || diagnostic.missingQuestions.length) return diagnostic;
  const retried = await retry();
  if (retried.missingQuestions.length) return retried;
  throw Object.assign(new Error('CLARIFICATION_REQUIRED'), { code: 'CLARIFICATION_REQUIRED' });
}
