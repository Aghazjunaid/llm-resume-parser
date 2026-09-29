// Step 1 for BOTH parsers: turn the uploaded file into plain text.
// No LLM here - libraries do this exactly and for free.

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { AppError } = require('../errors');

// Detect the type from the file's first bytes ("magic bytes") instead of trusting
// the filename. PDFs start with "%PDF"; DOCX files are ZIP archives starting with "PK".
function detectType(buffer) {
  const head = buffer.subarray(0, 4).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) return 'docx';
  return null;
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    // parseHyperlinks: clickable links (e.g. text "LinkedIn" pointing at a URL)
    // come out as [LinkedIn](https://...), so the URL isn't lost.
    // pageJoiner: '' removes the default "-- 1 of 2 --" page markers.
    const result = await parser.getText({ parseHyperlinks: true, pageJoiner: '' });
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractText(buffer) {
  const type = detectType(buffer);
  if (!type) throw new AppError(415, 'File content is not a valid PDF or DOCX');

  let text;
  try {
    text = type === 'pdf' ? await extractPdf(buffer) : await extractDocx(buffer);
  } catch (err) {
    throw new AppError(422, `Could not read the ${type.toUpperCase()} file: ${err.message}`);
  }

  // Normalise whitespace: tabs to spaces, trim each line, collapse runs of blank lines.
  text = text
    .replace(/\t+/g, '  ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < 20) {
    throw new AppError(422, 'No extractable text found. Is it a scanned (image-only) PDF?');
  }
  return text;
}

module.exports = { extractText };
