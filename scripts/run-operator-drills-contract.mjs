import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function runOperatorDrillsContract() {
  console.log("Operator drills contract runner executed");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOperatorDrillsContract();
}
