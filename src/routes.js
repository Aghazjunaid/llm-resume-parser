const express = require('express');
const upload = require('./upload');
const { AppError } = require('./errors');
const { extractText } = require('./services/textExtractor');
const { parseWithRules } = require('./services/ruleParser');
const { parseWithLlm } = require('./services/llmParser');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

// Both endpoints share everything except the parse step, so this wraps them.
// Express 5 forwards errors thrown in async handlers to the error handler automatically.
function parseRoute(method, parse) {
  return async (req, res) => {
    if (!req.file) throw new AppError(422, 'No file uploaded. Send it as form-data with the key "file".');

    const started = Date.now();
    const text = await extractText(req.file.buffer);
    const { data, meta } = await parse(text);

    const body = {
      method,
      filename: req.file.originalname,
      time_ms: Date.now() - started,
      meta: { text_chars: text.length, ...meta },
      data,
    };
    // ?includeText=true -> also return the extracted text, to see what the parser saw
    if (req.query.includeText === 'true') body.raw_text = text;
    res.json(body);
  };
}

// WITHOUT LLM: regex + keyword rules
router.post('/api/parse/rules', upload.single('file'), parseRoute('rules', parseWithRules));

// WITH LLM: Gemini
router.post('/api/parse/llm', upload.single('file'), parseRoute('llm', parseWithLlm));

module.exports = router;
