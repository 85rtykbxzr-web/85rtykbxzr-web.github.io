import { spawn } from "node:child_process";

const steps = [
  ["schedule sources", ["scripts/update-schedule.mjs"]],
  ["community trends", ["scripts/update-community-trends.mjs"]]
];

function runStep(label, args) {
  return new Promise((resolve, reject) => {
    console.log(`Starting ${label}...`);
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        console.log(`Completed ${label}.`);
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${code === null ? `signal ${signal}` : `exit ${code}`}`));
    });
  });
}

for (const [label, args] of steps) {
  await runStep(label, args);
}
