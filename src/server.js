const express = require('express');
const multer = require('multer');
const config = require('./config');
const routes = require('./routes');
const { AppError } = require('./errors');

const app = express();
app.disable('x-powered-by');

app.use(routes);

app.use((req, res) => {
  res.status(404).json({ detail: `Route ${req.method} ${req.path} not found`, status_code: 404 });
});

// Every error becomes the same JSON shape: { detail, status_code }
app.use((err, req, res, next) => {
  let status = 500;
  let detail = 'Internal server error';

  if (err instanceof AppError) {
    status = err.statusCode;
    detail = err.message;
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    detail = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${config.maxFileSizeMb} MB` : err.message;
    if (err.code === 'LIMIT_UNEXPECTED_FILE') detail = `Unexpected field "${err.field}". Use the form-data key "file".`;
  }

  // Log the full error for unexpected failures, never send the stack to the client.
  if (status >= 500) console.error(err);
  res.status(status).json({ detail, status_code: status });
});

app.listen(config.port, () => {
  console.log(`Resume parser listening on http://localhost:${config.port}`);
  console.log(`LLM provider: ${config.llm.provider} | model: ${config.llm.gemini.model}`);
});
