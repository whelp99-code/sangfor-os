#!/usr/bin/env tsx

import {
  MutationDeniedError,
  denyWorkflowMutation,
} from '../packages/shared/src/mutation-policy.js';

try {
  denyWorkflowMutation('wiki_sync');
} catch (error) {
  if (!(error instanceof MutationDeniedError)) throw error;
  process.stderr.write(`${error.code}\n`);
  process.exitCode = 64;
}
