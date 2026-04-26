/**
 * Minimal Anthropic API client for narrative generation.
 *
 * Single-purpose: generates JSON-formatted trader narratives.
 * Fails soft — returns null on any error so worker can continue.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 300;
const TIMEOUT_MS = 15000;

let client = null;
let Anthropic = undefined;

function loadSDK() {
  if (Anthropic !== undefined) {
    return Anthropic;
  }

  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (error) {
    console.error('[anthropicClient] @anthropic-ai/sdk not available:', error.message);
    Anthropic = null;
  }

  return Anthropic;
}

function getClient() {
  if (!ANTHROPIC_API_KEY) {
    return null;
  }
  const SDK = loadSDK();
  if (!SDK) {
    return null;
  }
  if (!client) {
    const AnthropicClient = SDK.default || SDK.Anthropic || SDK;
    client = new AnthropicClient({
      apiKey: ANTHROPIC_API_KEY,
      timeout: TIMEOUT_MS,
    });
  }
  return client;
}

/**
 * Send a structured prompt to Claude and parse JSON response.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<{ result: object|null, usage: { input_tokens: number, output_tokens: number }|null, error: string|null }>}
 */
async function generateJSON(systemPrompt, userMessage) {
  const c = getClient();
  if (!c) {
    if (!ANTHROPIC_API_KEY) {
      return { result: null, usage: null, error: 'ANTHROPIC_API_KEY not set' };
    }
    return { result: null, usage: null, error: '@anthropic-ai/sdk module not loaded' };
  }

  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      return { result: null, usage: null, error: 'no text block in response' };
    }

    const rawText = textBlock.text.trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      return {
        result: null,
        usage: null,
        error: `JSON parse failed: ${parseError.message} raw: ${cleaned.substring(0, 200)}`,
      };
    }

    return {
      result: parsed,
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
      },
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      usage: null,
      error: error.message,
    };
  }
}

module.exports = {
  generateJSON,
  MODEL,
};
