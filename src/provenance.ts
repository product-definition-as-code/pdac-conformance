import { createRequire } from 'node:module';
import type { ClaimOptions, ReportProvenance, RunnerIdentity, SpecSource } from './types.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name: string; version: string };

/** The installed package identifies the runner that made this observation. */
export function observedRunner(): RunnerIdentity {
  return { name: 'pdac-conformance', version: packageJson.version };
}

/** Keep user-provided claim labels separate from runner-observed state. */
export function reportProvenance(spec: SpecSource, claims: ClaimOptions = {}): ReportProvenance {
  return {
    observed: { runner: observedRunner(), spec },
    claimed: {
      implementation: {
        name: claims.implementationName ?? null,
        version: claims.implementationVersion ?? null,
        artifactIdentity: claims.implementationArtifact ?? null,
      },
      spec: {
        version: claims.specVersion ?? null,
        serializationVersion: claims.serializationVersion ?? null,
      },
    },
  };
}
