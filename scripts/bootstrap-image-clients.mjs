import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import * as oidc from "openid-client";
import { LocalHttpBrowser, LocalCheckError, requireCheck as check } from "./lib/local-http-browser.mjs";
import { verifyImageSeed } from "./lib/verify-image-seed.mjs";
import { restrictFileMode, setPrivateUmask } from "./lib/platform.mjs";

// Local-only provisioning through Encvoy 3.6.19's real OIDC and administration API.
// The vendor's built-in public client bootstraps the seeded Editor account.
setPrivateUmask();
const root = new URL("../", import.meta.url);
const origin = "http://localhost:9090";
const stateFile = new URL(".local/encvoy-image-bootstrap.json", root);
const clientsFile = new URL(".local/encvoy-image-clients.env", root);
let stage = "load-private-configuration";
class BuiltinAuthenticationRejected extends Error {}

function sameValues(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const sortedExpected = [...expected].sort();
  return [...actual].sort().every((value, index) => value === sortedExpected[index]);
}

function clientMatches(client, expected, names = [expected.name]) {
  return client && (names === null || names.includes(client.name)) && client.domain === expected.domain &&
    sameValues(client.redirect_uris, expected.redirect_uris) &&
    sameValues(client.grant_types, expected.grant_types) &&
    sameValues(client.response_types, expected.response_types) &&
    client.token_endpoint_auth_method === expected.token_endpoint_auth_method &&
    client.introspection_endpoint_auth_method === expected.introspection_endpoint_auth_method &&
    client.revocation_endpoint_auth_method === expected.revocation_endpoint_auth_method &&
    client.id_token_signed_response_alg === expected.id_token_signed_response_alg &&
    client.subject_type === expected.subject_type && typeof client.client_secret === "string";
}

function clientListItems(result) {
  const items = Array.isArray(result) ? result : result?.items ?? result?.data ?? result?.clients;
  check(Array.isArray(items), "The Encvoy client list returned an unsupported response.");
  const total = Array.isArray(result) ? undefined : result.totalCount ?? result.total_count ?? result.count;
  check(total === undefined || (Number.isFinite(Number(total)) && Number(total) <= items.length), "The Encvoy client list was incomplete.");
  check(items.length < 100, "The Encvoy client list may be incomplete.");
  return items;
}

async function privateAtomicWrite(file, content) {
  const temporary = new URL(file.href + `.${process.pid}.tmp`);
  await writeFile(temporary, content, { mode: 0o600 });
  await restrictFileMode(temporary, 0o600);
  await rename(temporary, file);
}

async function optionalRead(file) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function main() {
  const environment = parseEnv(await readFile(new URL(".local/encvoy-image.env", root), "utf8"));
  const fixtures = parseEnv(await readFile(new URL(".local/encvoy-image-fixtures.env", root), "utf8"));
  const progress = JSON.parse(await optionalRead(stateFile) || "{}");
  const clients = parseEnv(await optionalRead(clientsFile));
  check(environment.DOMAIN === origin && environment.CLIENT_ID, "Only the isolated localhost image stand is supported.");
  for (const key of ["ENCVOY_IMAGE_INITIAL_EDITOR_LOGIN", "ENCVOY_IMAGE_INITIAL_EDITOR_PASSWORD", "ENCVOY_IMAGE_EDITOR_PASSWORD"]) {
    check(fixtures[key], `Missing private setting ${key}.`);
  }
  progress.clientIntents ??= {};
  progress.userIntents ??= {};
  const saveProgress = () => privateAtomicWrite(stateFile, JSON.stringify(progress) + "\n");
  async function saveClients() {
    await privateAtomicWrite(clientsFile, Object.entries(clients).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join("\n") + "\n");
  }

  stage = "verify-seeded-root-password";
  await verifyImageSeed(environment);

  async function builtinLogin(login, password, identity) {
    const prefix = identity.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    stage = `${prefix}-oidc-discovery`;
    const configuration = await oidc.discovery(new URL(origin), environment.CLIENT_ID,
      { token_endpoint_auth_method: "none", id_token_signed_response_alg: "RS256" }, oidc.None(),
      { execute: [oidc.allowInsecureRequests], timeout: 15 });
    oidc.enableNonRepudiationChecks(configuration);
    check(configuration.serverMetadata().issuer === origin, "Unexpected bootstrap issuer.");
    const verifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const state = oidc.randomState();
    const authorization = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: origin + "/code", response_type: "code", response_mode: "query", scope: "openid",
      state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
    });
    const browser = new LocalHttpBrowser();
    let response = await browser.follow(authorization);
    const uid = response.url?.pathname.match(/^\/(?:api\/)?interaction\/([A-Za-z0-9_-]+)/)?.[1];
    check(uid, `The ${identity} login did not reach an Encvoy interaction (HTTP ${response.status}).`);
    stage = `${prefix}-credentials`;
    response = await browser.request(`${origin}/api/interaction/${uid}/auth?type=login`, {
      method: "POST", form: { identifier: login, password, prompt: "login" },
    });
    if (response.status === 200 || response.status === 201) {
      const widgetJson = response.text.match(/window\.__WIDGET_DATA__=(.*?)<\/script>/s)?.[1];
      const widget = widgetJson ? JSON.parse(widgetJson) : undefined;
      if (widget?.initialRoute === "password" && widget.envVars?.MESSAGE_DETAIL) {
        throw new BuiltinAuthenticationRejected(`Encvoy rejected the ${identity} authentication.`);
      }
      const routes = ["login", "password", "credentials", "error", "consent", "registration", "missing-data"];
      if (identity === "Editor") {
        console.log("Editor interaction response:", JSON.stringify({
          status: response.status, widget: Boolean(widget),
          route: routes.includes(widget?.initialRoute) ? widget.initialRoute : "other",
          hasMessage: Boolean(widget?.envVars?.MESSAGE), hasDetail: Boolean(widget?.envVars?.MESSAGE_DETAIL),
          jsonKeys: response.data ? Object.keys(response.data).filter((key) => ["message", "statusCode", "error", "location", "url"].includes(key)) : [],
        }));
      }
    }
    async function followRedirect(current) {
      const location = current.headers.get("location");
      check(current.status >= 300 && current.status < 400 && location, `The ${identity} interaction did not redirect (HTTP ${current.status}).`);
      return browser.follow(new URL(location, current.url));
    }
    response = await followRedirect(response);
    if (/^\/(?:api\/)?interaction\//.test(response.url?.pathname || "")) {
      stage = `${prefix}-consent`;
      const consentUid = response.url.pathname.match(/^\/(?:api\/)?interaction\/([A-Za-z0-9_-]+)/)?.[1];
      check(consentUid, `Invalid ${identity} consent interaction.`);
      response = await browser.request(`${origin}/api/interaction/${consentUid}/confirm`, { method: "POST", form: {} });
      response = await followRedirect(response);
    }
    check(response.url?.origin === origin && response.url.pathname === "/code", `${identity} authentication did not return to the registered callback.`);
    stage = `${prefix}-token-exchange`;
    const tokens = await oidc.authorizationCodeGrant(configuration, response.url, {
      expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true,
    });
    const subject = tokens.claims()?.sub;
    check(typeof subject === "string" && tokens.access_token, `The ${identity} login did not produce a signed subject and access token.`);
    return { accessToken: tokens.access_token, subject };
  }

  async function editorLogin(password) {
    const result = await builtinLogin(fixtures.ENCVOY_IMAGE_INITIAL_EDITOR_LOGIN, password, "Editor");
    check(result.subject === "2", "The bootstrap identity is not the seeded Editor.");
    return result.accessToken;
  }

  let password = fixtures.ENCVOY_IMAGE_EDITOR_PASSWORD;
  let accessToken;
  try {
    // Recover if a previous process stopped after the server changed the password
    // but before local progress was saved. Never retry on transport/protocol errors.
    accessToken = await editorLogin(password);
    progress.editorRotated = true;
    await saveProgress();
  } catch (error) {
    if (!(error instanceof BuiltinAuthenticationRejected) || progress.editorRotated) throw error;
    password = fixtures.ENCVOY_IMAGE_INITIAL_EDITOR_PASSWORD;
    accessToken = await editorLogin(password);
  }
  const admin = new LocalHttpBrowser();
  async function api(endpoint, method = "GET", body, form = false) {
    const response = await admin.request(`${origin}/api/v1/${endpoint}`, {
      method, token: accessToken, ...(body === undefined ? {} : form ? { form: body } : { json: body }),
    });
    if (response.status >= 400) {
      const messages = [response.data?.message, response.data?.error].flat();
      const codes = messages.flatMap((message) => typeof message === "string" ? message.match(/\bT3E\d{4}\b/g) || [] : []);
      if (codes.length) console.log("Encvoy validation codes:", [...new Set(codes)].join(", "));
    }
    check(response.status >= 200 && response.status < 300, `Encvoy administration request failed (HTTP ${response.status}).`);
    return response.data;
  }
  stage = "verify-editor-api-access";
  const editor = await api("users/me");
  check(String(editor?.id) === "2", "Administration API did not authenticate the seeded Editor.");

  if (!progress.editorRotated) {
    stage = "rotate-editor-password";
    await api("users/2/password", "PUT", { old_password: password, password: fixtures.ENCVOY_IMAGE_EDITOR_PASSWORD }, true);
    progress.editorRotated = true;
    await saveProgress();
    password = fixtures.ENCVOY_IMAGE_EDITOR_PASSWORD;
    // Encvoy revokes this user's tokens during password changes.
    accessToken = await editorLogin(password);
    stage = "verify-rotated-editor-api-access";
    check(String((await api("users/me"))?.id) === "2", "The rotated Editor could not authenticate.");
  }
  console.log("The seeded root password was verified and the Editor password rotation was verified.");

  for (const [actor, callback] of [["CUSTOMER", "/demo/callback"], ["USER", "/app/login"]]) {
    stage = `register-${actor.toLowerCase()}-client`;
    const key = `ENCVOY_${actor}_CLIENT_ID`;
    const secretKey = `ENCVOY_${actor}_CLIENT_SECRET`;
    const displayName = `Medusa ${actor.toLowerCase()} local demo`;
    if (clients[key]) {
      const existing = await api(`clients/${encodeURIComponent(clients[key])}`);
      const expected = {
        name: displayName,
        domain: "http://localhost:9000",
        redirect_uris: ["http://localhost:9000" + callback],
        grant_types: ["authorization_code"], response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic", introspection_endpoint_auth_method: "client_secret_basic",
        revocation_endpoint_auth_method: "client_secret_basic", id_token_signed_response_alg: "RS256", subject_type: "public",
      };
      check(String(existing?.client_id) === clients[key] && clientMatches(existing, expected, null) &&
        existing.client_secret === clients[secretKey], "The saved application does not match its callback/configuration or lacks its secret.");
      if (existing.name !== displayName) {
        await api(`clients/${encodeURIComponent(clients[key])}`, "PUT", { name: displayName });
        const renamed = await api(`clients/${encodeURIComponent(clients[key])}`);
        check(renamed?.name === displayName && clientMatches(renamed, expected), "The saved application could not be given a readable display name.");
      }
      continue;
    }
    let intent = progress.clientIntents[actor];
    if (!intent) {
      const nonce = randomBytes(16).toString("hex");
      intent = { nonce, name: displayName, status: "pending" };
      progress.clientIntents[actor] = intent;
      await saveProgress();
    }
    check(/^[a-f0-9]{32}$/.test(intent.nonce) && typeof intent.name === "string", "The saved client creation intent is invalid.");
    const expected = {
      name: displayName, domain: "http://localhost:9000",
      redirect_uris: ["http://localhost:9000" + callback], grant_types: ["authorization_code"], response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic", introspection_endpoint_auth_method: "client_secret_basic",
      revocation_endpoint_auth_method: "client_secret_basic", id_token_signed_response_alg: "RS256", subject_type: "public",
    };
    stage = `recover-${actor.toLowerCase()}-client`;
    const listed = clientListItems(await api("clients?limit=100&offset=0"));
    const legacyName = `Medusa ${actor.toLowerCase()} [${intent.nonce}]`;
    const candidates = listed.filter((client) => client?.name === displayName || client?.name === intent.name || client?.name === legacyName);
    check(listed.length === candidates.length, "The client search returned entries outside the saved creation intent.");
    check(candidates.length <= 1, "Several applications match the saved creation intent; refusing ambiguous recovery.");
    let created;
    if (candidates.length === 1) {
      const candidateId = candidates[0]?.client_id;
      check(typeof candidateId === "string", "The matching application list entry has no client ID.");
      const recovered = await api(`clients/${encodeURIComponent(candidateId)}`);
      check(clientMatches(recovered, expected, [displayName, intent.name, legacyName]), "The matching application does not have the saved configuration or recoverable secret.");
      created = { client_id: recovered.client_id, client_secret: recovered.client_secret };
      if (recovered.name !== displayName) {
        await api(`clients/${encodeURIComponent(candidateId)}`, "PUT", { name: displayName });
        const renamed = await api(`clients/${encodeURIComponent(candidateId)}`);
        check(renamed?.name === displayName && clientMatches(renamed, expected), "The recovered application could not be given a readable display name.");
      }
    } else {
      stage = `create-${actor.toLowerCase()}-client`;
      created = await api("clients", "POST", expected);
      check(typeof created?.client_id === "string" && typeof created?.client_secret === "string", "Application registration did not return client credentials.");
      const registered = await api(`clients/${encodeURIComponent(created.client_id)}`);
      check(clientMatches(registered, expected) && registered.client_secret === created.client_secret, "The created application does not match its saved configuration.");
    }
    clients[key] = created.client_id;
    clients[secretKey] = created.client_secret;
    await saveClients();
    intent.status = "complete";
    await saveProgress();
  }
  for (const role of ["CUSTOMER", "EMPLOYEE", "OUTSIDER"]) {
    stage = `register-${role.toLowerCase()}-fixture`;
    const login = fixtures[`ENCVOY_${role}_LOGIN`];
    const email = fixtures[`ENCVOY_${role}_EMAIL`];
    const fixturePassword = fixtures[`ENCVOY_${role}_PASSWORD`];
    check(login?.endsWith(".invalid") && !login.includes("@") && email?.endsWith(".invalid") && email.includes("@") && fixturePassword,
      "Only synthetic users with separate .invalid login and email fixtures may be provisioned.");
    const subjectKey = `ENCVOY_${role}_SUBJECT`;
    let intent = progress.userIntents[role];
    if (!intent) {
      intent = { login, email, status: "pending" };
      progress.userIntents[role] = intent;
      await saveProgress();
    }
    check(intent.login === login && intent.email === email, "The saved fixture creation intent no longer matches the private fixture settings.");
    let createdId;
    if (!clients[subjectKey]) {
      const loginExists = await api(`users/is-login-available?login=${encodeURIComponent(login)}`);
      check(typeof loginExists === "boolean", "Encvoy returned an unsupported fixture login lookup response.");
      if (!loginExists) {
        stage = `create-${role.toLowerCase()}-fixture`;
        const created = await api("users", "POST", {
          login, password: fixturePassword, email,
          given_name: role[0] + role.slice(1).toLowerCase(), family_name: "Test", nickname: `Local ${role.toLowerCase()}`,
        });
        check(created?.id !== undefined, "Test user creation did not return its subject.");
        createdId = String(created.id);
      }
    }
    stage = `verify-${role.toLowerCase()}-oidc-fixture`;
    const authenticated = await builtinLogin(login, fixturePassword, `${role} fixture`);
    if (createdId) check(createdId === authenticated.subject, "The created fixture ID does not match its signed OIDC subject.");
    if (clients[subjectKey]) check(String(clients[subjectKey]) === authenticated.subject, "The saved fixture subject does not match its signed OIDC subject.");
    stage = `verify-${role.toLowerCase()}-admin-fixture`;
    const record = await api(`clients/${encodeURIComponent(environment.CLIENT_ID)}/users/${encodeURIComponent(authenticated.subject)}`);
    check(String(record?.user?.id) === authenticated.subject && record.user.login === login && record.user.email === email && !record.user.deleted,
      "The signed fixture subject does not match its synthetic administrator-visible user.");
    // The image defaults to nickname/picture only for external OAuth clients.
    // Opt in these synthetic users' verified contact/name claims through their
    // own supported profile API; publicOauth does not publish them via Gravatar.
    stage = `configure-${role.toLowerCase()}-oauth-claims`;
    const fixtureBrowser = new LocalHttpBrowser();
    const claimFields = ["email", "email_verified", "given_name", "family_name"];
    const privacy = await fixtureBrowser.request(`${origin}/api/v1/users/${encodeURIComponent(authenticated.subject)}/private_scopes`, {
      method: "PUT", token: authenticated.accessToken,
      json: { claim_privacy: "publicOauth", field: claimFields.join(" ") },
    });
    check(privacy.status >= 200 && privacy.status < 300, `Synthetic OAuth claim configuration failed (HTTP ${privacy.status}).`);
    const configured = await fixtureBrowser.request(`${origin}/api/v1/users/me`, { token: authenticated.accessToken });
    check(configured.status === 200 && configured.data?.email_verified === true &&
      claimFields.every((field) => configured.data.public_profile_claims_oauth?.split(" ").includes(field)),
      "The synthetic user lacks verified email or the required OAuth claim permissions.");
    clients[subjectKey] = authenticated.subject;
    clients[`ENCVOY_${role}_LOGIN`] = login;
    clients[`ENCVOY_${role}_EMAIL`] = email;
    await saveClients();
    intent.status = "complete";
    await saveProgress();
  }
  console.log("Registered both confidential Medusa clients and three synthetic users through Encvoy's administration API.");
  console.log("Private client credentials and verified administrator-provisioned subjects are saved locally; no values printed.");
}

main().catch((error) => {
  console.error(`Image provisioning failed at ${stage}.`);
  if (error instanceof LocalCheckError) console.error(error.message);
  process.exitCode = 1;
});
