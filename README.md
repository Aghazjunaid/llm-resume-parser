# Resume Parser: rules vs LLM

Upload the same resume to two APIs and compare the JSON:

| API | How it parses | Speed | Cost |
|---|---|---|---|
| `POST /api/parse/rules` | Regex + keyword heuristics (no LLM) | ~50 ms | free |
| `POST /api/parse/llm` | Gemini (structured JSON output) | a few seconds | tokens |

Both return the **same JSON shape** (`src/schema.js`), so fields line up one-to-one.

## Run

```bash
npm install
cp .env.example .env     # then put your key in GEMINI_API_KEY
npm run dev              # http://localhost:3000
```

Get a Gemini key at https://aistudio.google.com/apikey

## Try it

```bash
# without LLM
curl -X POST localhost:3000/api/parse/rules -F "file=@samples/sample-resume.pdf"

# with LLM
curl -X POST localhost:3000/api/parse/llm -F "file=@samples/sample-resume.pdf"

# add ?includeText=true to either one to also see the text extracted from the file
```

Postman: `POST`, Body → `form-data`, key `file` (type **File**), choose a `.pdf` or `.docx`.

## What to look for in the diff (with `samples/sample-resume.pdf`)

The sample is built to hit common rule-based failures:

- **"Member of Technical Staff"** has no job-title keyword, so the rules parser calls it the company and loses "Zoho".
- **The freelance job** has no date range ("since 2019"), so the rules parser glues it onto the previous job.
- **Skills** only come from the Skills section plus a fixed dictionary, so Snowflake, Temporal, Shopify and Stripe are missed.
- **"VIT Vellore"** has no "University/College" keyword, so the institution is `null`.
- **Two projects** are merged into one, and the "OUTSIDE WORK" section (interests, blog) isn't recognised.

## Where the LLM is used

Only in `src/services/llmParser.js`. Everything else is plain code shared by both APIs:

```
file ──> textExtractor (pdf-parse / mammoth) ──> text
text ──> urlExtractor (regex) ──> URL list
                    │
     ┌──────────────┴──────────────┐
ruleParser.js                 llmParser.js
(regex, keywords)             prompt + URL list ──> Gemini ──> JSON
     │                              zod validate ──> invalid? one repair retry
     └──────────────┬──────────────┘
             same JSON shape
```

## Files

```
src/
  server.js              Express app + error handler ({ detail, status_code })
  routes.js              the two parse endpoints + /health
  config.js              env vars
  schema.js              zod schema, used to validate AND sent to Gemini as JSON Schema
  upload.js              multer (memory storage, .pdf/.docx only, size limit)
  services/
    textExtractor.js     PDF/DOCX -> text
    urlExtractor.js      regex URL finder (used by both parsers)
    ruleParser.js        WITHOUT LLM
    llmParser.js         WITH LLM: prompt, validation, repair retry
    llmProviders.js      Gemini client; add more providers here
samples/                 sample resume as .pdf, .docx and the source .html
```
