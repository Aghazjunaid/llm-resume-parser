// All settings come from environment variables.
// `npm start` loads .env automatically via `node --env-file-if-exists=.env`.

module.exports = {
  port: Number(process.env.PORT) || 3000,
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 10,
  llm: {
    provider: process.env.LLM_PROVIDER || 'gemini',
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    },
  },
};
