// Questions matching any of these should go to a human, not the AI.
const SENSITIVE_PATTERNS = [
  /harass|bully|discriminat|pelecehan|perundungan|diskriminasi/i,        // harassment / discrimination
  /lawsuit|sue|legal action|attorney|lawyer|tuntut|gugat|pengacara|somasi/i,  // legal
  /fired|terminat|wrongful dismissal|laid off|dipecat|pemecatan|diberhentikan|\bphk\b/i, // job loss
  /depress|suicid|self.?harm|mental health crisis|depresi|bunuh diri|melukai diri/i, // mental health
  /assault|abuse|violence|kekerasan|penganiayaan|pelecehan seksual/i,          // safety
];

// A friendly message that redirects to a real person.
export const ESCALATION_MESSAGE =
  "This is something best handled by a person directly. Please reach out to HR at " +
  "hr@company.example or use the confidential reporting form on the HR portal.\n\n" +
  "Hal ini sebaiknya ditangani langsung oleh staf HR. Silakan hubungi HR di " +
  "hr@company.example atau gunakan formulir pelaporan rahasia di portal HR.";

// YOUR PART: return true if the question matches ANY sensitive pattern.
export function isSensitive(question) {
  // TODO: use SENSITIVE_PATTERNS.some(...) with each pattern's .test(question)
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(question)) {
      return true;
    }
  }
  return false;
}