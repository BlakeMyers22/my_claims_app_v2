/************************************************
 * netlify/functions/generate-report.js
 ************************************************/
const { Configuration, OpenAIApi } = require("openai");
const axios = require("axios");

/**
 * If a new model name is placed in Netlify env var FINE_TUNED_MODEL_NAME,
 * we use it. Otherwise, fallback to "gpt-4o-mini-2024-07-18".
 */
const MODEL_NAME = process.env.FINE_TUNED_MODEL_NAME || "gpt-4o-mini-2024-07-18";

// Initialize OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

function safeString(value, fallback = "") {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return fallback;
}

// Example weather call (optional)
async function getWeatherData(location, dateString) {
  // ...
  // (If you want weather usage, you can implement it. Omitted for brevity.)
  return { success: true, data: {} };
}

function buildPrompt(section, context, weatherData, customInstructions = "") {
  // Just a simple prompt builder for demonstration
  let prompt = `You are a helpful forensic engineering assistant.\nUser wants section: ${section}\n`;
  prompt += `Address: ${safeString(context.address)}\n`;
  prompt += `Date of Loss: ${safeString(context.dateOfLoss)}\n`;
  if (weatherData && weatherData.condition) {
    prompt += `Weather condition: ${weatherData.condition}\n`;
  }
  if (customInstructions) {
    prompt += `\n**Additional instructions**: ${customInstructions}\n`;
  }
  prompt += `\nNow write a detailed, professional report section.\n`;
  return prompt;
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  try {
    const { section, context, customInstructions } = JSON.parse(event.body) || {};
    if (!section) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing section" }),
      };
    }
    // optional weather data
    let weatherResult = { success: true, data: {} };
    if (context?.dateOfLoss && context?.address) {
      weatherResult = await getWeatherData(context.address, context.dateOfLoss);
    }
    const prompt = buildPrompt(section, context, weatherResult.data, customInstructions);

    // Create chat completion with your chosen or fine-tuned model
    const completion = await openai.createChatCompletion({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
      temperature: 0.0,
      max_tokens: 1200,
    });

    const result = completion.data.choices[0].message.content || "";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        section: result,
        weatherData: weatherResult.data,
      }),
    };
  } catch (error) {
    console.error("Error in generate-report function:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to generate report section",
        details: error.message,
      }),
    };
  }
};
