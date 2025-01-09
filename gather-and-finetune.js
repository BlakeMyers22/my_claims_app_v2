/*********************************************
 * gather-and-finetune.js
 *
 * Usage:
 *   1) Install dependencies: npm install openai supabase @supabase/supabase-js axios
 *   2) Put your secrets in .env or environment variables:
 *      - SUPABASE_URL
 *      - SUPABASE_SERVICE_ROLE_KEY
 *      - OPENAI_API_KEY
 *      - NETLIFY_AUTH_TOKEN
 *      - NETLIFY_SITE_ID
 *   3) node gather-and-finetune.js
 *
 * This script:
 *   1. Fetches feedback from Supabase with rating >= 6
 *   2. Builds a JSONL
 *   3. Uploads to OpenAI, starts a GPT-3.5-turbo fine-tune
 *   4. Waits until done
 *   5. Updates Netlify env var FINE_TUNED_MODEL_NAME
 *   6. Triggers a redeploy
 ********************************************/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

async function main() {
  // 1) Connect to Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2) Query best feedback (rating >= 6)
  const { data: rows, error } = await supabase
    .from('feedback')
    .select('*')
    .gte('rating', 6);

  if (error) {
    console.error('Supabase query error:', error);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No feedback with rating >= 6 found. Exiting.');
    return;
  }

  console.log(`Found ${rows.length} high-rated feedback entries.`);

  // 3) Build JSONL lines
  // We'll store "prompt" and "completion"
  const lines = rows.map((row, i) => {
    // Example prompt: mention the section + user feedback
    const prompt = `Section: ${row.section_id}\nUser Feedback: ${row.feedback}\n\nGenerate improved final text:\n`;
    // We add a stop token at the end of the completion, e.g. " END"
    const completion = row.generated_text.trim() + " END";
    return JSON.stringify({ prompt, completion });
  });

  // 4) Write to a local file
  const outPath = path.join(__dirname, 'training-data.jsonl');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote JSONL with ${rows.length} lines to ${outPath}`);

  // 5) Initialize OpenAI
  const config = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
  });
  const openai = new OpenAIApi(config);

  // 6) Upload file to OpenAI
  console.log('Uploading training file to OpenAI...');
  const fileResp = await openai.createFile(
    fs.createReadStream(outPath),
    "fine-tune"
  );
  const fileId = fileResp.data.id;
  console.log('File uploaded. ID:', fileId);

  // 7) Start fine-tune
  console.log('Starting fine-tune job on gpt-3.5-turbo...');
  const ftResp = await openai.createFineTune({
    training_file: fileId,
    model: "gpt-3.5-turbo"
  });
  const jobId = ftResp.data.id;
  let status = ftResp.data.status;
  console.log('Fine-tune job started. ID:', jobId, 'Status:', status);

  // 8) Poll until finished
  while (status !== 'succeeded' && status !== 'failed') {
    console.log('Current fine-tune status:', status, ' ... waiting 30s');
    await new Promise(r => setTimeout(r, 30000));
    const check = await openai.retrieveFineTune(jobId);
    status = check.data.status;
  }

  if (status === 'failed') {
    console.error('Fine-tune job failed. Data:', status);
    process.exit(1);
  }

  // success
  const finalData = await openai.retrieveFineTune(jobId);
  const newModel = finalData.data.fine_tuned_model;
  console.log('Fine-tune succeeded! New model =', newModel);

  // 9) Update Netlify ENV var
  const netlifyToken = process.env.NETLIFY_AUTH_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  if (!netlifyToken || !siteId) {
    console.warn('Missing NETLIFY_AUTH_TOKEN or NETLIFY_SITE_ID. Manually set FINE_TUNED_MODEL_NAME to:', newModel);
    return;
  }

  // Get current env
  const envResp = await axios.get(`https://api.netlify.com/api/v1/sites/${siteId}/env`, {
    headers: { Authorization: `Bearer ${netlifyToken}` }
  });
  const envVars = envResp.data || [];
  const found = envVars.find(v => v.key === 'FINE_TUNED_MODEL_NAME');

  if (!found) {
    // create new
    console.log('Creating new Netlify env var: FINE_TUNED_MODEL_NAME');
    await axios.post(`https://api.netlify.com/api/v1/sites/${siteId}/env`, {
      key: 'FINE_TUNED_MODEL_NAME',
      values: { production: newModel }
    }, {
      headers: { Authorization: `Bearer ${netlifyToken}` }
    });
  } else {
    // update existing
    console.log('Updating existing Netlify env var: FINE_TUNED_MODEL_NAME');
    await axios.patch(`https://api.netlify.com/api/v1/sites/${siteId}/env/${found.id}`, {
      values: { production: newModel }
    }, {
      headers: { Authorization: `Bearer ${netlifyToken}` }
    });
  }

  // 10) Trigger a new build so the environment variable is live
  console.log('Triggering Netlify redeploy...');
  await axios.post(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {}, {
    headers: { Authorization: `Bearer ${netlifyToken}` }
  });
  console.log('Redeploy triggered. Done!');
}

main().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});

