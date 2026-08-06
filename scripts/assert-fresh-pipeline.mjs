const createdAt = process.env.CI_PIPELINE_CREATED_AT || "";
const maxAgeMinutes = Number(process.env.MAX_PIPELINE_AGE_MINUTES || 0);

if (!createdAt || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
  console.log("Pipeline age guard skipped outside a configured scheduled pipeline.");
  process.exit(0);
}

const createdTime = Date.parse(createdAt);
if (!Number.isFinite(createdTime)) {
  throw new Error(`CI_PIPELINE_CREATED_AT is invalid: ${createdAt}`);
}

const ageMinutes = (Date.now() - createdTime) / 60_000;
if (ageMinutes > maxAgeMinutes) {
  throw new Error(
    `Scheduled pipeline is ${ageMinutes.toFixed(1)} minutes old; refusing stale work older than ${maxAgeMinutes} minutes.`
  );
}

console.log(`Pipeline age guard passed (${ageMinutes.toFixed(1)}m <= ${maxAgeMinutes}m).`);
