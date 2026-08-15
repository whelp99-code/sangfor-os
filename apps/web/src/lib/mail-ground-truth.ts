import manifestInput from "../../../../docs/05_DATA_AI/BLRO_Mail_Classification_Ground_Truth_2026-08-12.json";
import { parseMailGroundTruthManifest } from "@sangfor/business";

export const approvedMailGroundTruthManifest =
  parseMailGroundTruthManifest(manifestInput);
