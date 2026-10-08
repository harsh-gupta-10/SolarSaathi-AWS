import { checkCognitoReadiness, formatReadiness } from "./auth-readiness";

async function main() {
  const report = await checkCognitoReadiness(process.env);
  console.log(formatReadiness(report));
  process.exitCode = report.status === "ready" ? 0 : 2;
}
void main().catch(() => {
  console.error("Cognito readiness could not complete. Check configuration and read-only AWS permissions.");
  process.exitCode = 2;
});
