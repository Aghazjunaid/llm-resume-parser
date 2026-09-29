// Finds every URL in the text with a regex. Used by BOTH parsers:
//  - rules parser: the regex is the only way it finds links
//  - LLM parser:   the list is injected into the prompt, so the LLM only has to
//                  decide which field each URL belongs to and can't skip one

const URL_RE = new RegExp(
  [
    String.raw`\bhttps?:\/\/[^\s<>()\[\]"'|,]+`, // https://anything
    String.raw`\bwww\.[^\s<>()\[\]"'|,]+`, // www.example.com/...
    // bare domain + path, e.g. linkedin.com/in/jane  (a path is required, so we
    // don't match the domain part of an email like jane@gmail.com)
    String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|io|dev|org|net|me|ai|co|app|xyz)\/[^\s<>()\[\]"'|,]*`,
  ].join('|'),
  'gi'
);

function extractUrls(text) {
  const found = new Map(); // lowercase key -> original; dedupes case-insensitively
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:)\]]+$/, ''); // drop trailing punctuation
    if (text[match.index - 1] === '@') continue; // domain part of an email address
    const key = url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (!found.has(key)) found.set(key, url);
  }
  return [...found.values()];
}

module.exports = { extractUrls };
