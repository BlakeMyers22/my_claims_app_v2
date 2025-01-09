/************************************************
 * netlify/functions/generate-report.js
 ************************************************/
const OpenAI = require('openai');
const axios = require('axios');

/**
 * We reference an environment variable FINE_TUNED_MODEL_NAME
 * which we will update after each new fine-tune completes.
 * If it's empty, default to "gpt-3.5-turbo".
 */
const MODEL_NAME = process.env.FINE_TUNED_MODEL_NAME || 'gpt-3.5-turbo';

/**
 * Initialize OpenAI with your API key.
 * Ensure OPENAI_API_KEY is set in your Netlify environment.
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Utility function: Safely convert a value to a string,
 * returning fallback if it's null/undefined or empty.
 */
function safeString(value, fallback = '') {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  return fallback;
}

/**
 * Utility function: Safely parse a date.
 * If parsing fails or the input is missing, return null.
 */
function safeParseDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Example of how you'd do a simple weather call (optional).
 */
async function getWeatherData(location, dateString) {
  try {
    if (!location || !dateString) {
      return { success: true, data: {} };
    }
    const dateObj = safeParseDate(dateString);
    if (!dateObj) {
      return { success: true, data: {} };
    }
    const today = new Date();
    if (dateObj > today) {
      return {
        success: true,
        data: { note: `Weather data not found for future date: ${dateObj.toISOString().split('T')[0]}` }
      };
    }
    // Suppose you have a WEATHER_API_KEY in Netlify as well
    const response = await axios.get('http://api.weatherapi.com/v1/history.json', {
      params: {
        key: process.env.WEATHER_API_KEY,
        q: location,
        dt: dateObj.toISOString().split('T')[0]
      }
    });

    const dayData = response.data.forecast.forecastday[0].day;
    return {
      success: true,
      data: {
        maxTemp: `${dayData.maxtemp_f}°F`,
        minTemp: `${dayData.mintemp_f}°F`,
        avgTemp: `${dayData.avgtemp_f}°F`,
        conditions: dayData.condition.text
      }
    };
  } catch (err) {
    console.error('Weather API Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Build the prompt for the user request, for demonstration.
 */
async function buildPrompt(section, context, weatherData) {
  let basePrompt = `You are a forensic engineering assistant. The user wants: ${section}. `;

  // Simple example: If user provided dateOfLoss & location, we mention it.
  if (context.dateOfLoss && context.address) {
    basePrompt += `The date of loss: ${context.dateOfLoss}, address: ${context.address}. `;
  }

  // If we have weather data:
  if (weatherData && weatherData.conditions) {
    basePrompt += `Weather was: ${weatherData.conditions}. `;
  }

  basePrompt += `Now write a professional section.`;

  return basePrompt;
}

/**
 * Netlify serverless function entry point
 */
exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const { section, context } = JSON.parse(event.body) || {};
    if (!section || !context) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing section or context' })
      };
    }

    // Optionally fetch weather
    let weatherResult = { success: true, data: {} };
    if (context.dateOfLoss && context.address) {
      weatherResult = await getWeatherData(context.address, context.dateOfLoss);
    }

    // Build final prompt
    const promptText = await buildPrompt(section, context, weatherResult.data);

    // Create the chat completion using our environment's fine-tuned model or fallback
    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,  // <--- this uses the fine-tuned model if set
      messages: [
        {
          role: 'system',
          content: promptText
        }
      ],
      temperature: 0.0,
      max_tokens: 1000
    });

    const result = completion.choices[0].message.content || '';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        section: result,
        weatherData: weatherResult.data
      })
    };

  } catch (error) {
    console.error('Error in generate-report function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to generate report section',
        details: error.message
      })
    };
  }
};

