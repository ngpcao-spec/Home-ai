// Rebuild intake facts from the original request and all confirmed answers.
// Classification confidence is deliberately not a completeness signal.
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const has = (text, expressions) => expressions.some(expression => expression.test(text));
const targetPatterns = [
  /\bo cam\b/, /\bcong tac\b/, /\bden\b/, /\bcau dao\b/, /\baptomat\b/,
  /\bday dien\b/, /\bmach dien\b/, /\bvoi\b/, /\bbon rua\b/, /\bbon cau\b/,
  /\bong\b/, /\bsen\b/, /\bmay lanh\b/, /\bdieu hoa\b/, /\bmay giat\b/,
  /\btu lanh\b/, /\bbep\b/, /\blo nuong\b/, /\bquat\b/, /\bbinh nong lanh\b/,
];
const observedProblemPatterns = [
  /\bkhong (?:co dien|len dien|hoat dong|chay|sang|mat|lanh|thoat nuoc|vao nuoc)\b/,
  /\bmat dien\b/, /\bbi (?:ro|ri|nghet|tac|chap|chay|vo|nut|nhay)\b/,
  /\b(?:ro ri|ri nuoc|nuoc chay|chay nuoc|nhay lien tuc|mui khet|phat tia lua|keu to|rung manh)\b/,
];
const concreteActionPatterns = [/\b(?:thay|lap|lap dat|ve sinh|bao duong|di doi)\b/];
const quantityPatterns = [
  /\b\d+\b/, /\b(?:mot|hai|ba|bon|nam|nhieu|vai) (?:cai|chiec|bo|o cam|may|den|voi)\b/,
];
const genericWords = new Set([
  'toi', 'minh', 'can', 'muon', 'tim', 'goi', 'thue', 'nho', 'cho', 'giup',
  'tho', 'nguoi', 'dich', 'vu', 'sua', 'chua', 'kiem', 'tra', 'bi', 'hong',
  'hu', 'mot', 'vai', 'nhieu', 'cai', 'chiec', 'bo', 'he', 'thong', 'trong',
  'nha', 'cua', 'nay', 'do', 'gi', 've', 'phan', 'van', 'de',
  'khong', 'co', 'hoat', 'dong', 'chay', 'sang', 'mat', 'lanh', 'ro', 'ri',
  'nghet', 'tac', 'chap', 'vo', 'nut', 'nhay', 'lien', 'tuc', 'mui', 'khet',
  'phat', 'tia', 'lua', 'keu', 'to', 'rung', 'manh',
]);
const broadServiceNames = [
  'dien gia dung', 'dieu hoa', 'may lanh', 'may giat', 'tu lanh',
  'ong nuoc', 'nuoc', 'dien',
];

export function getIntakeCompleteness({ description, clarifications = [] }) {
  const text = [description, ...clarifications.map(item => item.answer)].map(normalize).join(' ');
  const usableText = text.replace(/\b(?:khong biet|khong ro|chua biet|chua ro)\b/g, ' ');
  let remainder = ` ${usableText} `;
  for (const service of broadServiceNames) remainder = remainder.replaceAll(` ${service} `, ' ');
  const hasSpecificWords = remainder.trim().split(/\s+/).some(word => word
    && !genericWords.has(word) && !/^\d+$/.test(word));
  const knownFacts = {
    target: has(usableText, targetPatterns) || hasSpecificWords,
    observedProblem: has(usableText, observedProblemPatterns),
    concreteAction: has(usableText, concreteActionPatterns),
    quantity: has(usableText, quantityPatterns),
  };
  const missingFacts = [];
  if (!knownFacts.target) missingFacts.push('target_or_work_area');
  if (!knownFacts.observedProblem && !knownFacts.concreteAction) {
    missingFacts.push('observable_problem_or_concrete_action');
  }
  return { knownFacts, missingFacts, complete: missingFacts.length === 0 };
}

export function requiresIntakeClarification(input) {
  return input.clarifications.length < 3 && !getIntakeCompleteness(input).complete;
}

function repeatedQuestion(question, input) {
  const proposed = normalize(question);
  const { knownFacts } = getIntakeCompleteness(input);
  if (knownFacts.quantity && /\b(?:bao nhieu|so luong|may cai|may chiec)\b/.test(proposed)) return true;
  if (knownFacts.target && /\b(?:thiet bi nao|vat dung nao|can sua gi|sua cai gi)\b/.test(proposed)) return true;
  if (knownFacts.observedProblem && /\b(?:gap van de gi|hien tuong gi|trieu chung gi|bi gi)\b/.test(proposed)) return true;
  return input.clarifications.some(item => {
    const previous = normalize(item.question);
    if (previous === proposed) return true;
    const previousWords = new Set(previous.split(' ').filter(word => word.length > 2));
    const proposedWords = new Set(proposed.split(' ').filter(word => word.length > 2));
    const shared = [...previousWords].filter(word => proposedWords.has(word)).length;
    return previousWords.size >= 3 && proposedWords.size >= 3
      && shared / Math.max(previousWords.size, proposedWords.size) >= 0.8;
  });
}

export async function enforceIntakeCompleteness({ input, diagnostic, retry }) {
  if (input.clarifications.length >= 3) return { ...diagnostic, missingQuestions: [] };
  const usableQuestion = result => result.missingQuestions[0]
    && !repeatedQuestion(result.missingQuestions[0].question, input);
  if (usableQuestion(diagnostic)) return diagnostic;
  if (!requiresIntakeClarification(input) && !diagnostic.missingQuestions.length) return diagnostic;
  const retried = await retry();
  if (usableQuestion(retried)) return retried;
  throw Object.assign(new Error('CLARIFICATION_REQUIRED'), { code: 'CLARIFICATION_REQUIRED' });
}
