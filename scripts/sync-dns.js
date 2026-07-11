const fs = require("fs");
const path = require("path");

const DOMAINS_DIR = path.join(__dirname, "..", "domains");
const ROOT_DOMAIN = "retro-slop.com";

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;

if (!CF_API_TOKEN || !CF_ZONE_ID) {
  console.error("Missing CF_API_TOKEN or CF_ZONE_ID environment variables.");
  process.exit(1);
}

const CF_API = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records`;

async function cfRequest(pathSuffix, options = {}) {
  const res = await fetch(`${CF_API}${pathSuffix}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    console.error("Cloudflare API error:", JSON.stringify(data.errors));
    throw new Error("Cloudflare API request failed");
  }
  return data;
}

async function getExistingRecord(name) {
  const data = await cfRequest(`?name=${encodeURIComponent(name)}`);
  return data.result[0] || null;
}

async function upsertRecord(subdomain, record) {
  const fullName = `${subdomain}.${ROOT_DOMAIN}`;
  const existing = await getExistingRecord(fullName);

  const body = {
    type: record.type,
    name: fullName,
    content: record.value,
    ttl: 1, // "automatic" in Cloudflare
    proxied: record.type === "CNAME" || record.type === "A", // orange-cloud for CDN+HTTPS
  };

  if (existing) {
    if (
      existing.type === body.type &&
      existing.content === body.content
    ) {
      console.log(`⏭  ${fullName} already up to date`);
      return;
    }
    await cfRequest(`/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    console.log(`Updated ${fullName} -> ${record.value}`);
  } else {
    await cfRequest("", {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(`Created ${fullName} -> ${record.value}`);
  }
}

async function main() {
  const files = fs
    .readdirSync(DOMAINS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "_example.json");

  console.log(`Found ${files.length} domain file(s) to sync.`);

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DOMAINS_DIR, file), "utf8"));
    try {
      await upsertRecord(data.subdomain, data.record);
    } catch (e) {
      console.error(`Failed to sync ${file}:`, e.message);
      process.exitCode = 1;
    }
  }
}

main();
