/************************************************
 * netlify/functions/generate-report.js
 ************************************************/
const OpenAI = require('openai');
const axios = require('axios');

/**
 * If a new model name is placed into Netlify env var FINE_TUNED_MODEL_NAME,
 * we use it, else default to 'gpt-4o-mini-2024-07-18'.
 */
const MODEL_NAME = process.env.FINE_TUNED_MODEL_NAME || 'gpt-4o-mini-2024-07-18';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function safeParseDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return null;
  return d;
}

// Example weather call, optional
async function getWeatherData(location, dateString) {
  try {
    if (!location || !dateString) {
      return { success: true, data: {} };
    }
    const dateObj = safeParseDate(dateString);
    if (!dateObj) {
      return { success: true, data: {} };
    }
    // if date is future
    const now = new Date();
    if (dateObj > now) {
      return { success: true, data: { note: `Future date: ${dateString}` } };
    }
    // If you have an API key for WeatherAPI in Netlify
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
        condition: dayData.condition.text
      }
    };
  } catch (err) {
    console.error('Weather error:', err);
    return { success: false, error: err.message };
  }
}

// Simple prompt builder
function buildPrompt(section, context, weatherData) {
  let prompt = `You are a forensic engineering assistant. The user wants a section: ${section}.\n`;
  if (context.address) {
    prompt += `Address: ${context.address}\n`;
  }
  if (context.dateOfLoss) {
    prompt += `Date of Loss: ${context.dateOfLoss}\n`;
  }
  if (weatherData?.condition) {
    prompt += `Weather condition: ${weatherData.condition}\n`;
  }
  prompt += `Write a concise, professional report section.\n`;
  return prompt;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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

    // optional weather fetch
    let weatherResult = { success: true, data: {} };
    if (context.dateOfLoss && context.address) {
      weatherResult = await getWeatherData(context.address, context.dateOfLoss);
    }

    const prompt = buildPrompt(section, context, weatherResult.data);

    // GPT call
    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: prompt }
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
    console.error('generate-report error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
