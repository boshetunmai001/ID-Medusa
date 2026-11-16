import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import path from "node:path";
import { LocalCheckError, LocalHttpBrowser, requireCheck as check } from "./lib/local-http-browser.mjs";

const medusa = "http://localhost:9000";
const issuer = "http://localhost:9090";
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
let stage = "load-private-fixtures";

async function main() {
  if (process.env.RUN_ENCVOY_ACCEPTANCE !== "1") throw new Error("Set RUN_ENCVOY_ACCEPTANCE=1 for the isolated local stand.");
  const fixtures = parseEnv(await readFile(new URL(".local/encvoy-image-fixtures.env", root), "utf8"));
  const clients = parseEnv(await readFile(new URL(".local/encvoy-image-clients.env", root), "utf8"));
  for (const role of ["CUSTOMER", "EMPLOYEE", "OUTSIDER"]) {
    check(
      fixtures[`ENCVOY_${role}_LOGIN`]?.endsWith(".invalid") &&
      fixtures[`ENCVOY_${role}_EMAIL`]?.endsWith(".invalid") &&
      fixtures[`ENCVOY_${role}_PASSWORD`],
      "Only complete synthetic fixture settings are accepted.",
    );
  }

  async function api(browser, path, method = "GET", token, json) {
    return browser.request(medusa + path, { method, token, ...(method === "POST" ? { json: json ?? {} } : {}) });
  }

  function callbackUrl(actor) {
    return `${medusa}${actor === "customer" ? "/demo/callback" : "/app/login"}`;
  }

  async function begin(browser, actor = "customer", body = {}) {
    const started = await api(browser, `/auth/${actor}/encvoy-${actor}`, "POST", undefined, body);
    check(started.status === 200 && typeof started.data?.location === "string", `Medusa login initiation failed (HTTP ${started.status}).`);
    const authorization = new URL(started.data.location);
    check(authorization.origin === issuer, "Medusa returned an unexpected identity provider.");
    check(authorization.searchParams.get("client_id") === clients[actor === "user" ? "ENCVOY_USER_CLIENT_ID" : "ENCVOY_CUSTOMER_CLIENT_ID"], "Medusa did not use the registered client for this actor.");
    check(authorization.searchParams.get("redirect_uri") === callbackUrl(actor), "Medusa changed the registered callback URL.");
    check(authorization.searchParams.get("code_challenge_method") === "S256", "PKCE S256 was not requested.");
    check(typeof authorization.searchParams.get("state") === "string" && authorization.searchParams.get("state").length > 0, "Medusa did not return an authorization state.");
    return authorization;
  }

  async function postCallback(browser, authorization, fields = {}) {
    return api(browser, "/auth/customer/encvoy-customer/callback", "POST", undefined, {
      state: authorization.searchParams.get("state"),
      ...fields,
    });
  }

  function expectAuthError(response, message, label) {
    check(response.status === 401 && response.data?.message === message && !response.data?.token, label);
  }

  async function expectNoCustomerSession(browser, label) {
    const profile = await api(browser, "/encvoy/profile");
    check(profile.status === 401, label);
  }

  function interactionId(response) {
    const match = response.url?.pathname.match(/^\/(?:api\/)?interaction\/([^/]+)/);
    check(match && /^[A-Za-z0-9_-]+$/.test(match[1]), "Expected the local Encvoy interaction page.");
    return match[1];
  }

  async function next(browser, response) {
    const location = response.headers.get("location");
    check(response.status >= 300 && response.status < 400 && location, "Expected an Encvoy redirect after the interaction submission.");
    return browser.follow(new URL(location, response.url));
  }

  async function login(browser, role, actor = "customer", callbackFields = {}) {
    stage = `${role.toLowerCase()}-${actor}-start`;
    const authorization = await begin(browser, actor);
    let response = await browser.follow(authorization);
    let prompted = false;
    if (!response.callback) {
      stage = `${role.toLowerCase()}-${actor}-credentials`;
      prompted = true;
      const uid = interactionId(response);
      // Contract inspected in the exact Encvoy 3.6.19 backend and widget images.
      const submitted = await browser.request(`${issuer}/api/interaction/${uid}/auth?type=login`, {
        method: "POST", form: { identifier: fixtures[`ENCVOY_${role}_LOGIN`], password: fixtures[`ENCVOY_${role}_PASSWORD`], prompt: "login" },
      });
      response = await next(browser, submitted);
    }
    if (!response.callback) {
      stage = `${role.toLowerCase()}-${actor}-consent`;
      const uid = interactionId(response);
      const consent = await browser.request(`${issuer}/api/interaction/${uid}/confirm`, { method: "POST", form: {} });
      response = await next(browser, consent);
    }
    check(response.callback, "Encvoy did not return to the registered callback.");
    const callback = response.callback;
    check(callback.pathname === (actor === "customer" ? "/demo/callback" : "/app/login"), "Encvoy returned to the wrong actor callback.");
    check(callback.searchParams.get("state") === authorization.searchParams.get("state"), "Encvoy returned a different state.");
    const payload = {};
    for (const key of ["code", "state", "iss", "error"]) {
      check(callback.searchParams.getAll(key).length <= 1, "Encvoy returned duplicate callback parameters.");
      if (callback.searchParams.has(key)) payload[key] = callback.searchParams.get(key);
    }
    stage = `${role.toLowerCase()}-${actor}-callback`;
    const completed = await api(browser, `/auth/${actor}/encvoy-${actor}/callback`, "POST", undefined, { ...payload, ...callbackFields });
    if (completed.status !== 200) {
      const safeErrors = ["invalid_response", "login_expired", "cancellation", "not_authorized", "provider_unavailable", "email_not_verified"];
      if (safeErrors.includes(completed.data?.message)) console.log(`Medusa callback result: ${completed.data.message}.`);
    }
    return { completed, payload, prompted };
  }

  async function completeCustomer(browser, token) {
    stage = "complete-customer";
    const completions = await Promise.all(Array.from({ length: 8 }, () => api(browser, "/encvoy/customer/complete", "POST", token)));
    check(completions.every((response) => response.status === 200), "Concurrent native customer completion failed.");
    const ids = completions.map((response) => response.data?.customer?.id);
    check(typeof ids[0] === "string" && ids.every((id) => id === ids[0]), "Concurrent customer completion did not resolve one account.");
    const session = await api(browser, "/auth/session", "POST", token);
    check(session.status === 200, `Medusa session creation failed (HTTP ${session.status}; ${session.data?.message ?? "no_message"}).`);
    const profile = await api(browser, "/encvoy/profile");
    check(profile.status === 200 && profile.data?.customer?.id === ids[0], "Protected customer profile does not match the completed account.");
    return { id: ids[0], token };
  }

  const customer = new LocalHttpBrowser();
  const first = await login(customer, "CUSTOMER");
  check(first.completed.status === 200 && typeof first.completed.data?.token === "string", `Real customer authentication failed (HTTP ${first.completed.status}).`);
  const account = await completeCustomer(customer, first.completed.data.token);
  console.log("PASS real customer OIDC login, eight concurrent completions and protected profile.");

  stage = "cancellation-consumes-state";
  const cancellationBrowser = new LocalHttpBrowser();
  const cancellationAuthorization = await begin(cancellationBrowser);
  expectAuthError(await postCallback(cancellationBrowser, cancellationAuthorization, { error: "access_denied" }), "cancellation", "Provider cancellation unexpectedly succeeded.");
  expectAuthError(await postCallback(cancellationBrowser, cancellationAuthorization, { error: "access_denied" }), "login_expired", "Cancelled state was reusable.");
  await expectNoCustomerSession(cancellationBrowser, "Provider cancellation created a customer session.");
  console.log("PASS provider cancellation consumes its state and creates no customer session.");

  stage = "wrong-browser-proof";
  const stateOwner = new LocalHttpBrowser();
  const otherBrowser = new LocalHttpBrowser();
  const ownedAuthorization = await begin(stateOwner);
  const otherAuthorization = await begin(otherBrowser);
  expectAuthError(await postCallback(otherBrowser, ownedAuthorization, { error: "access_denied" }), "login_expired", "A different browser proof consumed the owner's state.");
  expectAuthError(await postCallback(stateOwner, ownedAuthorization, { error: "access_denied" }), "cancellation", "The owner could not cancel after another browser's attempt.");
  expectAuthError(await postCallback(stateOwner, ownedAuthorization, { error: "access_denied" }), "login_expired", "Owner cancellation did not consume its state.");
  expectAuthError(await postCallback(otherBrowser, otherAuthorization, { error: "access_denied" }), "cancellation", "The second browser's own state was not usable.");
  await expectNoCustomerSession(stateOwner, "Owner cancellation created a customer session.");
  await expectNoCustomerSession(otherBrowser, "Rejected cross-browser callback created a customer session.");
  console.log("PASS a different browser proof cannot consume state; the owner can still cancel, and neither browser gets a session.");

  stage = "changed-state";
  const changedStateBrowser = new LocalHttpBrowser();
  const changedStateAuthorization = await begin(changedStateBrowser);
  const originalState = changedStateAuthorization.searchParams.get("state");
  const changedState = `${originalState[0] === "A" ? "B" : "A"}${originalState.slice(1)}`;
  expectAuthError(await postCallback(changedStateBrowser, changedStateAuthorization, { state: changedState, error: "access_denied" }), "login_expired", "A changed state was accepted.");
  expectAuthError(await postCallback(changedStateBrowser, changedStateAuthorization, { error: "access_denied" }), "cancellation", "A changed-state attempt consumed the original state.");
  expectAuthError(await postCallback(changedStateBrowser, changedStateAuthorization, { error: "access_denied" }), "login_expired", "The original state remained reusable after cancellation.");
  await expectNoCustomerSession(changedStateBrowser, "Changed-state callbacks created a customer session.");
  console.log("PASS changed state is rejected without consuming the original state; cancellation then consumes it.");

  stage = "callback-url-overrides";
  const overrideBrowser = new LocalHttpBrowser();
  for (const key of ["callback_url", "callbackUrl", "return_to", "returnTo"]) {
    const rejected = await api(overrideBrowser, "/auth/customer/encvoy-customer", "POST", undefined, { [key]: "https://attacker.invalid/callback" });
    check(rejected.status === 401 && rejected.data?.message === "invalid_response" && !rejected.data?.location, "An unapproved callback override was accepted.");
  }
  const fixedAuthorization = await begin(overrideBrowser);
  expectAuthError(await postCallback(overrideBrowser, fixedAuthorization, { error: "access_denied" }), "cancellation", "The accepted authorization request did not retain its registered callback.");
  expectAuthError(await postCallback(overrideBrowser, fixedAuthorization, { error: "access_denied" }), "login_expired", "The accepted callback state remained reusable.");
  await expectNoCustomerSession(overrideBrowser, "Rejected callback override attempts created a customer session.");
  const callbackOverrideBrowser = new LocalHttpBrowser();
  const callbackOverride = await login(callbackOverrideBrowser, "CUSTOMER", "customer", { return_to: "https://attacker.invalid/callback" });
  expectAuthError(callbackOverride.completed, "invalid_response", "An unapproved callback return URL was accepted.");
  const callbackOverrideReplay = await api(callbackOverrideBrowser, "/auth/customer/encvoy-customer/callback", "POST", undefined, callbackOverride.payload);
  expectAuthError(callbackOverrideReplay, "login_expired", "A callback rejected for an unapproved return URL remained reusable.");
  await expectNoCustomerSession(callbackOverrideBrowser, "Rejected callback return URL created a customer session.");
  console.log("PASS unapproved callback and return URL fields are rejected; accepted authorization keeps the registered callback.");

  stage = "customer-callback-replay";
  const replay = await api(customer, "/auth/customer/encvoy-customer/callback", "POST", undefined, first.payload);
  check(replay.status !== 200 && !replay.data?.token, "Callback replay unexpectedly succeeded.");
  const deniedAdmin = await api(customer, "/admin/users/me", "GET", account.token);
  check(deniedAdmin.status === 401 || deniedAdmin.status === 403, "Customer token accessed the Admin API.");
  console.log("PASS callback replay rejected; customer denied from Admin API.");

  stage = "customer-logout";
  const oldSession = customer.clone();
  check((await api(customer, "/auth/session", "DELETE")).status === 200, "Customer logout failed.");
  check((await api(customer, "/encvoy/profile")).status === 401, "Profile remained accessible after logout.");
  check((await api(oldSession, "/encvoy/profile")).status === 401, "The previous session cookie remained valid after logout.");
  const retainedToken = await api(new LocalHttpBrowser(), "/auth/token/refresh", "POST", account.token);
  check(retainedToken.status === 401 && retainedToken.data?.message === "reauthentication_required", "Customer JWT refresh was not refused after logout.");
  console.log("PASS local session logout invalidates the old cookie; Encvoy customer JWT refresh is refused.");

  const repeat = await login(customer, "CUSTOMER");
  check(repeat.completed.status === 200 && typeof repeat.completed.data?.token === "string", "Repeat Encvoy login failed.");
  const same = await completeCustomer(customer, repeat.completed.data.token);
  check(same.id === account.id, "Repeat login created a different customer.");
  console.log(`PASS repeat login returns the same customer; Encvoy requested credentials: ${repeat.prompted}.`);
  await api(customer, "/auth/session", "DELETE");

  const employee = new LocalHttpBrowser();
  const staff = await login(employee, "EMPLOYEE", "user");
  check(staff.completed.status === 200 && typeof staff.completed.data?.token === "string", `Pre-authorized employee authentication failed (HTTP ${staff.completed.status}).`);
  const staffProfile = await api(employee, "/admin/users/me", "GET", staff.completed.data.token);
  check(staffProfile.status === 200 && staffProfile.data?.user?.email === fixtures.ENCVOY_EMPLOYEE_EMAIL, "The authenticated Medusa employee does not match the pre-authorized fixture.");
  const staffRefresh = await api(employee, "/auth/token/refresh", "POST", staff.completed.data.token);
  check(staffRefresh.status === 401 && staffRefresh.data?.message === "reauthentication_required", "Envcoy employee JWT refresh was not refused.");
  console.log("PASS real pre-authorized employee OIDC login and native Admin API.");
  const customerRecords = await api(employee, `/admin/customers?email=${encodeURIComponent(fixtures.ENCVOY_CUSTOMER_EMAIL)}`, "GET", staff.completed.data.token);
  check(customerRecords.status === 200 && customerRecords.data?.count === 1 && customerRecords.data?.customers?.[0]?.id === account.id, "The native customer listing did not confirm exactly one fixture account.");
  console.log("PASS native Admin listing confirms exactly one customer for the fixture email.");

  const usersBefore = await api(employee, "/admin/users", "GET", staff.completed.data.token);
  check(usersBefore.status === 200 && Number.isInteger(usersBefore.data?.count), "Could not count pre-existing Medusa employees.");
  const outsider = await login(new LocalHttpBrowser(), "OUTSIDER", "user");
  check(outsider.completed.status !== 200 && !outsider.completed.data?.token, "An unbound Encvoy user received employee access.");
  const usersAfter = await api(employee, "/admin/users", "GET", staff.completed.data.token);
  check(usersAfter.status === 200 && usersAfter.data?.count === usersBefore.data.count, "An unbound login created a Medusa employee.");
  console.log("PASS unbound Encvoy user denied employee access.");

  stage = "uncompleted-customer-session";
  const uncompletedBrowser = new LocalHttpBrowser();
  const uncompleted = await login(uncompletedBrowser, "OUTSIDER");
  check(uncompleted.completed.status === 200 && typeof uncompleted.completed.data?.token === "string", "Synthetic uncompleted customer identity did not authenticate at Encvoy.");
  const prematureSession = await api(uncompletedBrowser, "/auth/session", "POST", uncompleted.completed.data.token);
  check(prematureSession.status === 401 && prematureSession.data?.message === "customer_account_not_completed", `An uncompleted customer identity established a Medusa session (HTTP ${prematureSession.status}; ${prematureSession.data?.message ?? "no_message"}).`);
  await expectNoCustomerSession(uncompletedBrowser, "An uncompleted customer identity accessed the protected profile.");
  console.log("PASS customer session is refused until the persisted Medusa customer link exists.");

  stage = "prepare-existing-email-conflict";
  const conflictPath = `/admin/customers?email=${encodeURIComponent(fixtures.ENCVOY_OUTSIDER_EMAIL)}`;
  let conflictRecords = await api(employee, conflictPath, "GET", staff.completed.data.token);
  check(conflictRecords.status === 200, "Could not inspect the synthetic conflict fixture.");
  if (conflictRecords.data?.count === 0) {
    const created = await api(employee, "/admin/customers", "POST", staff.completed.data.token, { email: fixtures.ENCVOY_OUTSIDER_EMAIL });
    check(created.status === 200, "Could not create the synthetic guest conflict fixture.");
    conflictRecords = await api(employee, conflictPath, "GET", staff.completed.data.token);
  }
  const guest = conflictRecords.data?.customers?.[0];
  check(conflictRecords.data?.count === 1 && guest?.has_account === false, "The email-conflict fixture must be one unbound guest customer.");
  const conflictingBrowser = new LocalHttpBrowser();
  const conflictingLogin = await login(conflictingBrowser, "OUTSIDER");
  check(conflictingLogin.completed.status === 200 && typeof conflictingLogin.completed.data?.token === "string", "The conflict fixture did not authenticate at Encvoy.");
  stage = "existing-email-conflict";
  const refused = await api(conflictingBrowser, "/encvoy/customer/complete", "POST", conflictingLogin.completed.data.token);
  // Medusa 2.21.2 maps DUPLICATE_ERROR to 422 in its native error handler.
  check(refused.status === 422 && refused.data?.type === "duplicate_error" && refused.data?.message?.includes("account_conflict"), "Existing email did not produce the explicit account conflict.");
  const unchanged = await api(employee, conflictPath, "GET", staff.completed.data.token);
  check(unchanged.status === 200 && unchanged.data?.count === 1 && unchanged.data?.customers?.[0]?.id === guest.id && unchanged.data?.customers?.[0]?.has_account === false, "Existing guest account changed after the conflicting login.");
  console.log("PASS real Encvoy login with an existing email is refused without taking over the guest account.");

  stage = "revoke-employee-grants";
  const currentProject = process.cwd();
  const projectDirectory = existsSync(path.join(currentProject, "node_modules/@medusajs/cli/cli.js"))
    ? currentProject
    : path.join(rootPath, "examples/medusa");
  const cliPath = path.join(projectDirectory, "node_modules/@medusajs/cli/cli.js");
  const revoke = spawnSync(process.execPath, [cliPath, "exec", "./src/scripts/revoke-employee.ts"], {
    cwd: projectDirectory,
    env: { ...process.env, EMPLOYEE_MEDUSA_USER_ID: staffProfile.data.user.id },
    stdio: "ignore",
  });
  check(!revoke.error && revoke.status === 0, "Employee grant revocation command failed.");
  const revokedRequest = await api(new LocalHttpBrowser(), "/admin/users/me", "GET", staff.completed.data.token);
  check(revokedRequest.status === 401 || revokedRequest.status === 403, "An employee JWT remained valid after its grant was revoked.");
  console.log("PASS the operator revocation command immediately denies the copied employee JWT on the next Admin request.");
  check(clients.ENCVOY_CUSTOMER_CLIENT_ID && clients.ENCVOY_USER_CLIENT_ID, "Registered client settings are incomplete.");
  console.log("Real Encvoy HTTP acceptance completed. This does not claim Safari interaction coverage.");
}

main().catch((error) => {
  // All authored errors are safe labels; fetch and parser errors can contain URLs.
  console.error(`Real Encvoy acceptance failed at ${stage}.`);
  if (error instanceof LocalCheckError) console.error(error.message);
  process.exitCode = 1;
});
