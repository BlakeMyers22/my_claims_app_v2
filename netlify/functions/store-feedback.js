/******************************************
 * netlify/functions/store-feedback.js
 ******************************************/
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing Supabase env vars' })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = JSON.parse(event.body);

    const { data, error } = await supabase
      .from('feedback')
      .insert([{
        timestamp: body.timestamp,
        section_id: body.sectionId,
        rating: body.rating ? parseInt(body.rating, 10) : null,
        feedback: body.feedback,
        generated_text: body.generatedText
      }]);

    if (error) {
      console.error('Supabase insert error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, inserted: data })
    };

  } catch (err) {
    console.error('store-feedback error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
