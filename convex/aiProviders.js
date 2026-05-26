const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_GROQ_TEXT_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];

const DEFAULT_GEMINI_VISION_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
];

export async function generateGroqText(prompt, options = {}) {
  return await generateGroqCompletionWithFallback({
    models: options.model ? [options.model] : getGroqTextModels(),
    messages: [{ role: "user", content: prompt }],
    temperature: options.temperature ?? 0.2,
  });
}

export async function generateGeminiVisionText({
  prompt,
  imageBase64,
  mimeType,
  model,
}) {
  return await generateGeminiVisionWithFallback({
    models: model ? [model] : getGeminiVisionModels(),
    prompt,
    imageBase64,
    mimeType,
  });
}

async function generateGroqCompletionWithFallback({
  models,
  messages,
  temperature,
}) {
  const errors = [];

  for (const model of models) {
    try {
      return await generateGroqCompletion({ model, messages, temperature });
    } catch (error) {
      errors.push(`${model}: ${getErrorMessage(error)}`);

      if (!isFallbackError(error, "GROQ_API_KEY")) {
        throw error;
      }
    }
  }

  throw new Error(`All Groq text models failed. Tried: ${errors.join(" | ")}`);
}

async function generateGroqCompletion({ model, messages, temperature }) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  const responseText = await response.text();
  const data = parseJson(responseText);

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      responseText ||
      `Groq request failed with status ${response.status}`;
    throw new Error(`[Groq ${response.status}] ${message}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }

  throw new Error("Groq response did not include message content.");
}

async function generateGeminiVisionWithFallback({
  models,
  prompt,
  imageBase64,
  mimeType,
}) {
  const errors = [];

  for (const model of models) {
    try {
      return await generateGeminiVision({ model, prompt, imageBase64, mimeType });
    } catch (error) {
      errors.push(`${model}: ${getErrorMessage(error)}`);

      if (!isFallbackError(error, "GEMINI_API_KEY")) {
        throw error;
      }
    }
  }

  throw new Error(
    `All Gemini vision models failed. Tried: ${errors.join(" | ")}`
  );
}

async function generateGeminiVision({ model, prompt, imageBase64, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(
    `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );

  const responseText = await response.text();
  const data = parseJson(responseText);

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      responseText ||
      `Gemini vision request failed with status ${response.status}`;
    throw new Error(`[Gemini ${response.status}] ${message}`);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (text) {
    return text;
  }

  throw new Error("Gemini vision response did not include text content.");
}

function getGroqTextModels() {
  return parseModelList(process.env.GROQ_TEXT_MODEL, DEFAULT_GROQ_TEXT_MODELS);
}

function getGeminiVisionModels() {
  return parseModelList(
    process.env.GEMINI_VISION_MODEL,
    DEFAULT_GEMINI_VISION_MODELS
  );
}

function parseModelList(value, fallbackModels) {
  const models = String(value ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length > 0 ? models : fallbackModels;
}

function isFallbackError(error, apiKeyName) {
  const message = getErrorMessage(error);

  if (new RegExp(`${apiKeyName}|401|403|unauthorized|forbidden|auth`, "i").test(message)) {
    return false;
  }

  return /400|404|408|409|429|500|502|503|504|rate|quota|limit|unavailable|overloaded|not found|no endpoints|unsupported|provider/i.test(
    message
  );
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}