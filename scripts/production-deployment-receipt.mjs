import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionAuthority, signDeploymentReceipt, verifyDeploymentReceipt } from "./lib/production-authority.mjs";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA64_ID = /^sha256:[a-f0-9]{64}$/u;

export function validateDeploymentReceipt(receipt, { projectName, apiImage, webImage, composePath, authoritySha256 }) {
  if (receipt.schemaVersion !== 2 || !SHA40.test(receipt.candidateSha ?? "") || receipt.projectName !== projectName) throw new Error("deployment receipt identity invalid");
  if (receipt.imageTags?.api !== `${apiImage}:${receipt.candidateSha}` || receipt.imageTags?.web !== `${webImage}:${receipt.candidateSha}` || !SHA64_ID.test(receipt.imageIds?.api ?? "") || !SHA64_ID.test(receipt.imageIds?.web ?? "")) throw new Error("deployment receipt image identity invalid");
  if (receipt.authoritySha256 !== authoritySha256) throw new Error("deployment receipt authority mismatch");
  if (typeof receipt.composeArtifact !== "string" || basename(receipt.composeArtifact) !== receipt.composeArtifact || basename(composePath) !== receipt.composeArtifact) throw new Error("deployment receipt compose artifact path invalid");
  const composeBytes = readFileSync(composePath);
  if (receipt.composeSha256 !== createHash("sha256").update(composeBytes).digest("hex")) throw new Error("deployment receipt compose artifact mismatch");
  return receipt;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith("--") || !rest[index + 1]) throw new Error("invalid deployment receipt arguments");
    values[rest[index].slice(2)] = rest[index + 1];
  }
  return { command, values };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { command, values } = parseArgs(process.argv.slice(2));
    const { authority, authoritySha256 } = loadProductionAuthority();
    if (command === "sign") {
      const receipt = JSON.parse(readFileSync(values.input, "utf8"));
      const signed = signDeploymentReceipt({ ...receipt, authoritySha256 }, authority);
      writeFileSync(values.output, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600 });
      chmodSync(values.output, 0o600);
    } else if (command === "verify") {
      const receipt = verifyDeploymentReceipt(JSON.parse(readFileSync(values.receipt, "utf8")), authority);
      const composePath = resolve(values["deployment-dir"], receipt.composeArtifact);
      validateDeploymentReceipt(receipt, { projectName: values.project, apiImage: values["api-image"], webImage: values["web-image"], composePath, authoritySha256 });
      process.stdout.write([receipt.candidateSha, receipt.imageTags.api, receipt.imageIds.api, receipt.imageTags.web, receipt.imageIds.web, composePath].join("\t"));
    } else {
      throw new Error("usage: production-deployment-receipt sign|verify ...");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
