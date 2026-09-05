import { config } from "dotenv";
config({ path: ".env.local" });
import {
  cleanupAllV1TestData,
  tableCounts,
  closeDb,
  requireV1Env,
} from "../e2e/helpers/v1";

async function main() {
  requireV1Env();
  await cleanupAllV1TestData();
  console.log(await tableCounts());
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
