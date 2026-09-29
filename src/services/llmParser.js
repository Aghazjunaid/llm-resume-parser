// ============================================================================
// "WITH LLM" parser.
//
// This is the ONLY place the LLM is used. Text extraction, URL finding and
// validation are all plain code; the LLM does the one thing code can't do
// reliably - understand free-form text and map it into structured fields.
//
//   text + URL list + rules  --->  Gemini  --->  JSON  --->  zod validation
//                                                              |
//                                     invalid? one repair retry <-+
// ============================================================================

const { z } = require('zod');
const { ResumeSchema, resumeJsonSchema } = require('../schema');
const { extractUrls } = require('./urlExtractor');
const { getHeaderText } = require('./ruleParser');
const { normalizeResumeSkills } = require('./skillNormalizer');
const { getProvider } = require('./llmProviders');
const { AppError } = require('../errors');

function buildPrompt(text, urls) {
  const urlList = urls.length ? urls.map((u) => `  - ${u}`).join('\n') : '  (none)';

  return `You are a resume parser. Extract the resume below into JSON matching the provided schema.

Rules:
- Use ONLY information written in the resume. Never invent or guess. Use null for missing values and [] for missing lists.
- contact.location: ONLY a location written in the contact details at the top. If there is none, use null. Do NOT fill it from a job's or a college's location, even if it seems obvious.
- work_experience: one entry per distinct job (a role at a company, with its own dates). Do not split one job into two or merge two jobs into one. Count the jobs before writing the JSON.
- projects: only projects the resume explicitly lists.
- skills: scan EVERY section (skills list, job bullets, projects, certifications, education). One skill per element.
- No duplicate skills, including spelling variants of the same skill. Write each skill ONCE using its official name: "Next.js" (not also "Next"), "TypeScript" (not "Typescript"), "PostgreSQL" (not also "Postgres"). Use the same names in every technologies list. Keep genuinely different skills separate, e.g. "SQL" (language) and "MS SQL Server" (database).
- responsibilities: one bullet per element, worded as in the resume.
- github: the person's profile URL (github.com/<user>). Repository links go in the matching project's url.
- Dates: YYYY-MM when the month is known, otherwise YYYY. Use "Present" for current roles.
- languages: spoken languages (English, Hindi...), not programming languages.

URLs found in the document by a regex. Assign each one to the correct field; any that fit nowhere go in contact.other_links:
${urlList}

Resume text:
"""
${text}
"""`;
}

function buildRepairPrompt(originalPrompt, badOutput, error) {
  return `${originalPrompt}

Your previous answer did not match the schema.
Error:
${error}

Previous answer:
${badOutput}

Return the corrected JSON only.`;
}

// Even with structured output, never trust LLM output blindly: parse + validate.
function validate(raw) {
  let json;
  try {
    // Strip ```json fences in case a provider without JSON mode adds them.
    json = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err.message}` };
  }
  const result = ResumeSchema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, data: result.data };
}

// The prompt makes guessing LESS LIKELY; this check makes sure. It's plain code, so
// it can't be talked out of the rule. Each correction is reported in meta.corrections
// so you can see when the LLM guessed.
function verifyAgainstText(data, text) {
  const corrections = [];
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const header = normalize(getHeaderText(text));

  // Every part of "City, Country" must be written in the header. This also catches
  // the LLM adding a country the resume never mentions.
  const location = data.contact.location;
  if (location) {
    const parts = location.split(',').map(normalize).filter(Boolean);
    if (!parts.every((part) => header.includes(part))) {
      corrections.push(`contact.location "${location}" is not in the resume header, set to null`);
      data.contact.location = null;
    }
  }
  return corrections;
}

async function parseWithLlm(text) {
  const provider = getProvider();
  const urls = extractUrls(text);
  const prompt = buildPrompt(text, urls);
  const tokens = { input_tokens: 0, output_tokens: 0 };

  const call = async (p) => {
    const reply = await provider.complete(p, resumeJsonSchema);
    tokens.input_tokens += reply.usage.input_tokens;
    tokens.output_tokens += reply.usage.output_tokens;
    return reply.text;
  };

  let attempts = 1;
  let output = await call(prompt);
  let result = validate(output);

  if (!result.ok) {
    // LLMs occasionally return broken JSON. One "please fix this" retry
    // recovers most cases cheaply.
    console.warn(`[llm] attempt 1 invalid, retrying with repair prompt: ${result.error}`);
    attempts = 2;
    output = await call(buildRepairPrompt(prompt, output, result.error));
    result = validate(output);
    if (!result.ok) throw new AppError(502, `LLM returned invalid output twice: ${result.error}`);
  }

  const corrections = [...verifyAgainstText(result.data, text), ...normalizeResumeSkills(result.data)];

  return {
    data: result.data,
    meta: { provider: provider.name, model: provider.model, attempts, urls_found: urls.length, tokens, corrections },
  };
}

module.exports = { parseWithLlm };
