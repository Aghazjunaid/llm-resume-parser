// LLM providers behind one small interface:
//
//   provider.complete(prompt, jsonSchema) -> { text, usage }
//
// llmParser.js only talks to this interface, so adding OpenAI/Groq/Ollama later means
// writing one more factory here and setting LLM_PROVIDER in .env.

const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { AppError } = require('../errors');

function createGeminiProvider({ apiKey, model }) {
  if (!apiKey) throw new AppError(500, 'GEMINI_API_KEY is not set. Add it to .env and restart the server.');
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: 'gemini',
    model,
    async complete(prompt, jsonSchema) {
      let response;
      try {
        response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            // "Structured output": Gemini is forced to reply with JSON matching this
            // schema. Without it the model might wrap JSON in ```fences``` or add
            // chatty text around it. (Temperature is left at the default, which
            // Google recommends for Gemini 3 models.)
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
          },
        });
      } catch (err) {
        // err.status is the HTTP status from Google (400 bad key, 429 rate limit, 404 unknown model...)
        const status = err.status === 429 ? 429 : 502;
        throw new AppError(status, `Gemini API error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
      }

      return {
        text: response.text ?? '',
        usage: {
          input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}

const PROVIDERS = {
  gemini: createGeminiProvider,
};

let cached = null;

function getProvider() {
  if (cached) return cached;
  const { provider } = config.llm;
  const create = PROVIDERS[provider];
  if (!create) {
    throw new AppError(500, `LLM_PROVIDER "${provider}" is not supported. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  cached = create(config.llm[provider]);
  return cached;
}

module.exports = { getProvider };
