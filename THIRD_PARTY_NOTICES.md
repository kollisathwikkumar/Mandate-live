# Third-party notices for the Mandate frontend/API snapshot

The root `LICENSE` applies to the Mandate-owned material that the authorized rights holder has elected to release under MIT. It does **not** relicense third-party dependencies. The repository contains dependency declarations and lockfiles, not vendored `node_modules`.

## Direct frontend dependencies

- **MIT:** `@phosphor-icons/react`, `@react-three/fiber`, `lenis`, `motion`, `react`, `react-dom`, `react-router-dom`, `three`, `zod`.
- **Apache-2.0:** `oidc-client-ts` (its package supplies a separate license file).
- **GSAP Standard no-charge license:** `gsap`, `@gsap/react`; applicable terms: <https://gsap.com/standard-license/>. GSAP is not MIT-licensed by this repository. Preserve GSAP proprietary notices and comply with its permitted-use restrictions.

## Direct backend dependencies

- **Apache-2.0:** `@aws-sdk/client-s3`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-sesv2`, `@modelcontextprotocol/server`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-pg`, `@opentelemetry/sdk-node`.
- **MIT:** `@fastify/otel`, `@fastify/proxy-addr`, `ethers`, `fastify`, `jose`, `pg`, `zod`.

The package versions and transitive dependencies are pinned by the package lockfiles and retain their own terms and notices. Verify notice inclusion for any separately distributed production bundle or container. No React Bits-adapted source component remains in this projection; its formerly accompanying notice was excluded with the components, not stripped from covered code.
