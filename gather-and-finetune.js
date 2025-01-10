/*********************************************
 * gather-and-finetune.js
 *
 * Usage: invoked by a GitHub Action workflow
 * that sets environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 *   NETLIFY_AUTH_TOKEN
 *   NETLIFY_SITE_ID
 ********************************************/
const fs = require("fs");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { Configuration, OpenAIApi } = require("openai");

(async function main() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase env vars.");
      process.exit(1);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) fetch feedback where rating >= 6
    const { data: rows, error } = await supabase
      .from("feedback")
      .select("*")
      .gte("rating", 6);

    if (error) {
      console.error("Supabase query error:", error);
      process.exit(1);
    }
    if (!rows || rows.length === 0) {
      console.log("No high-rated feedback found. Exiting.");
      process.exit(0);
    }

    console.log(`Found ${rows.length} high-rated feedback entries.`);

    // 2) Build JSONL
    const lines = rows.map((row) => {
      const prompt = `Section: ${row.section_id}\nUser feedback: ${row.feedback}\n\nNow produce the final text:\n`;
      const completion = `${row.generated_text.trim()} END`;
      return JSON.stringify({ prompt, completion });
    });
    fs.writeFileSync("training-data.jsonl", lines.join("\n") + "\n", "utf8");
    console.log(`Wrote JSONL with ${rows.length} lines to training-data.jsonl`);

    // 3) OpenAI init
    const config = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const openai = new OpenAIApi(config);

    // 4) Upload file
    console.log("Uploading training-data.jsonl to OpenAI...");
    const fileResp = await openai.createFile(
      fs.createReadStream("training-data.jsonl"),
      "fine-tune"
    );
    const fileId = fileResp.data.id;
    console.log("File uploaded. ID:", fileId);

    // 5) Start fine-tune on "gpt-4o-mini-2024-07-18" or "gpt-3.5-turbo"? 
    // The user says "openai site says gpt-4o-mini-2024-07-18 is allowed." 
    // We'll assume the user can do that:
    const baseModel = "gpt-4o-mini-2024-07-18";

    console.log(`Starting fine-tune job with base model: ${baseModel}`);
    const ftResp = await openai.createFineTune({
      training_file: fileId,
      model: baseModel,
      // You can add a suffix if you want
      // suffix: "mySuffix",
    });
    const jobId = ftResp.data.id;
    let status = ftResp.data.status;
    console.log("Fine-tune job started. ID:", jobId, "status:", status);

    // 6) Poll until done
    while (status !== "succeeded" && status !== "failed") {
      console.log("Current fine-tune status:", status, "... waiting 30s");
      await new Promise((r) => setTimeout(r, 30000));
      const check = await openai.retrieveFineTune(jobId);
      status = check.data.status;
    }

    if (status === "failed") {
      console.error("Fine-tune job failed!");
      process.exit(1);
    }

    const finalJob = await openai.retrieveFineTune(jobId);
    const newModel = finalJob.data.fine_tuned_model;
    console.log("Fine-tune succeeded! New model =", newModel);

    // 7) Update Netlify environment var
    const netlifyToken = process.env.NETLIFY_AUTH_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    if (!netlifyToken || !siteId) {
      console.warn("Missing NETLIFY_AUTH_TOKEN or NETLIFY_SITE_ID. Please manually set FINE_TUNED_MODEL_NAME to:", newModel);
      process.exit(0);
    }

    // fetch existing env
    const envResp = await axios.get(`https://api.netlify.com/api/v1/sites/${siteId}/env`, {
      headers: { Authorization: `Bearer ${netlifyToken}` },
    });
    const envVars = envResp.data || [];
    const found = envVars.find((v) => v.key === "FINE_TUNED_MODEL_NAME");

    if (!found) {
      // create new
      console.log("Creating new Netlify env var FINE_TUNED_MODEL_NAME");
      await axios.post(
        `https://api.netlify.com/api/v1/sites/${siteId}/env`,
        {
          key: "FINE_TUNED_MODEL_NAME",
          values: { production: newModel },
        },
        {
          headers: { Authorization: `Bearer ${netlifyToken}` },
        }
      );
    } else {
      // update existing
      console.log("Updating existing Netlify env var FINE_TUNED_MODEL_NAME");
      await axios.patch(
        `https://api.netlify.com/api/v1/sites/${siteId}/env/${found.id}`,
        {
          values: { production: newModel },
        },
        {
          headers: { Authorization: `Bearer ${netlifyToken}` },
        }
      );
    }

    // 8) Trigger Netlify redeploy
    console.log("Triggering Netlify redeploy...");
    await axios.post(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {}, {
      headers: { Authorization: `Bearer ${netlifyToken}` },
    });
    console.log("Redeploy triggered. Done!");
    process.exit(0);
  } catch (err) {
    console.error("Fine-tune script error:", err);
    process.exit(1);
  }
})();
