# Source-built Encvoy stand

This page describes the separate source build at `research/encvoy-id`, pinned
to commit `5579bf5c05464da48585be28a3863c915b9b704f` (package version 1.2.0;
backend `VERSION` 1.2.17). The local dependency locks are preserved in
`infra/encvoy-locks/`; the OIDC lock resolves `oidc-provider` exactly to 8.8.1.
Dependencies and generated Prisma artifacts stay in the Encvoy checkout and do
not change the root Medusa install.

## Source stand setup

If `research/encvoy-id` is not present, create the isolated source checkout:

```sh
mkdir -p research
git clone https://github.com/encvoy/id.git research/encvoy-id
git -C research/encvoy-id checkout --detach 5579bf5c05464da48585be28a3863c915b9b704f
```

The source build has its own PostgreSQL service and volume, separate from the
Medusa database and the old `encvoy` database. Create the private Encvoy
environment from `.local/infra.env`, then use the repository's Node 22 runtime.
From the repository root, start the source-only database profile:

```sh
export PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH"
docker compose --profile encvoy-source --env-file .local/infra.env -f infra/compose.yaml up -d --wait
node scripts/encvoy-env.mjs
node scripts/encvoy-build.mjs
node scripts/encvoy-local.mjs
```

This source profile uses `127.0.0.1:55433/encvoy_source`. Never point the
source build at `127.0.0.1:55432/encvoy`: that older database was involved in
a migration incident and is explicitly refused by the build guard. Prisma
deployment changes schema; obtain approval before running it against any
persistent database, and use only an isolated synthetic test database.
The environment generator preserves an existing `.local/encvoy.env`; if it
was created before this isolated profile existed, update only its `DATABASE_URL`
to `postgresql://medusa:<existing-local-password>@127.0.0.1:55433/encvoy_source`.
Do not print or share the full URL.

After the source stand reports ready, provision it from a second terminal:

```sh
export PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH"
node scripts/encvoy-provision.mjs
```

The build uses saved locks with `npm ci` when present (or resolves and saves
them on the first run), generates both Prisma clients, deploys Encvoy's schema,
and builds each application. It records `.local/encvoy-build-stamp.json` only
after the full build succeeds for the pinned source. The local runner refuses
to start unless that stamp still matches the source commit and OIDC version.
The provisioner is intended to use Encvoy's owner API to create clients and
confirmed synthetic `.invalid` users. Keep client secrets and fixture
passwords in mode-restricted files under `.local`; do not copy them into
project configuration or logs. Raw service output is drained by the local
runner.

## Current source-build status

The old source database at `127.0.0.1:55432/encvoy` has historical schema
changes and must not be used. The source build now targets a separate Compose
database at `127.0.0.1:55433/encvoy_source`; its migration has not been run in
this verification pass. OIDC, auth, and shared components compile. At the pinned pristine commit, the
backend and widget builds fail on the two upstream defects below. In the
ignored working checkout, local uncommitted fixes for those defects have since
allowed both backend and widget production builds to pass. This only confirms
compilation: the patched source has not been run, provisioned, or accepted as
a functioning Encvoy stand. The build script still checks out the pristine
pinned source state, so it remains blocked until a deliberate tracked repair
is reviewed.

Backend check:

```sh
export PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH"
npm --prefix research/encvoy-id/packages/backend run build
```

This exits nonzero with 18 TS2339 errors: `UserRoles` in `src/enums.ts` omits
`TRUSTED_USER`, although backend code references it throughout the helpers,
clients, groups, interactions, invitations, tokens, and users modules. The
first error is `src/helpers.ts:383`; the remaining diagnostics report the same
missing enum member.

Widget check:

```sh
export PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH"
npm --prefix research/encvoy-id/packages/widget-auth run build
```

This exits nonzero because `src/lib/utils.ts` imports and calls
`isTrustedKerberosProvider`, which is not exported from `src/types/types.ts`.
Turbopack reports the missing export for both client and server-rendered
bundles.

Both defects are present in the initial upstream import
`ec4625631e4fc6ce85bcf8af5a07ed705ea5581a` and in the pinned commit. The local
ignored checkout has two uncommitted changes: add `TRUSTED_USER =
'TRUSTED_USER'` to `UserRoles`; add and export `isTrustedKerberosProvider` as a
type guard for `IGenericProvider` credentials providers. These changes repaired
the compile errors only. The remote exposes only `main`, with no tags or
alternate branches, so the fetched history contains no earlier coherent
snapshot to substitute. Do not treat the local patch as an upstream fix or as
runtime evidence.

## Official image release tested separately

The [upstream installer guide](https://git.digtlab.ru/trusted/id/-/blob/main/docs/en/docs-02-box-system-install.md)
links a Compose file using `registry.digtlab.ru/trusted/id` images. The four
application images were verified as Encvoy 3.6.19, imported for `linux/amd64`,
and run in an isolated local Compose project. Their immutable manifest and
config digests, runtime setup, and real OIDC/Medusa acceptance evidence are
listed in [docs/encvoy-image.md](encvoy-image.md).

The image configs provide no source revision, source URL, or version labels.
The official GitLab source has a `v3.2.53` tag, while this pinned GitHub source
is version 1.2.0. There is no source ref tying the `3.6.19` image manifests to
this checkout. Successful image acceptance does not establish that the
pinned GitHub source builds or that both distributions are equivalent.

## Intended endpoints for the source stand

If the pinned source is repaired and builds cleanly, its loopback proxy is
intended to serve Encvoy at `http://localhost:9090` and route `/oidc`,
`/.well-known`, `/api`, `/auth`, and the dashboard. Expected endpoints are:

- `http://localhost:9090/.well-known/openid-configuration` — OIDC discovery
- `http://localhost:9090/oidc/jwks` — signing keys
- `http://localhost:9090/api/health` — backend health
- `http://localhost:9090/auth/health` — auth-service health

The intended clients use confidential `client_secret_basic` authentication,
authorization-code-only grants, RS256, and `openid email profile` scopes. Their
callbacks are `http://localhost:9000/demo/callback` (customer) and
`http://localhost:9000/app/login` (employee). The stand is localhost-only and
uses HTTP for browser testing. Fixture identities use reserved `.invalid`
addresses so email cannot reach real recipients.
