import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateJwtToken, Modules } from "@medusajs/framework/utils";
import { entityId } from "medusa-plugin-encvoy-id";
import { completeCustomer } from "../lib/customer-account";
import { stateStore } from "../lib/state-store";

type ActorType = "customer" | "user";

export default async function checkIntegration({ container }: ExecArgs): Promise<void> {
  if (process.env.RUN_MEDUSA_INTEGRATION !== "1") {
    throw new Error("Set RUN_MEDUSA_INTEGRATION=1 to run the destructive-fixture-safe integration check.");
  }

  const browserOrigin = process.env.MEDUSA_BROWSER_ORIGIN;
  if (!browserOrigin || new URL(browserOrigin).protocol !== "http:") {
    throw new Error("This integration check is restricted to the local HTTP demo origin.");
  }
  const browserUrl = new URL(browserOrigin);
  if (!["localhost", "127.0.0.1"].includes(browserUrl.hostname)) {
    throw new Error("This integration check is restricted to loopback hosts.");
  }
  const requestBase = new URL(browserUrl);
  requestBase.hostname = "127.0.0.1";

  const auth = container.resolve(Modules.AUTH);
  const customers = container.resolve(Modules.CUSTOMER);
  const users = container.resolve(Modules.USER);
  const apiKeys = container.resolve(Modules.API_KEY);
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
  const suffix = randomBytes(12).toString("hex");
  const issuer = "https://encvoy-integration.invalid";
  const clientId = `integration-client-${suffix}`;
  const authIdentityIds: string[] = [];
  const customerIds: string[] = [];
  const userIds: string[] = [];
  const apiKeyIds: string[] = [];
  let sessionCookie: string | undefined;
  let employeeSessionCookie: string | undefined;
  let publishableApiKey: string | undefined;

  async function createIdentity(
    actorType: ActorType,
    subject: string,
    email: string,
    appMetadata: Record<string, unknown> = {},
  ): Promise<{ id: string; entityId: string }> {
    const identityEntityId = entityId(issuer, subject, clientId, actorType);
    const identity = await auth.createAuthIdentities({
      app_metadata: appMetadata,
      provider_identities: [{
        provider: actorType === "customer" ? "encvoy-customer" : "encvoy-user",
        entity_id: identityEntityId,
        provider_metadata: {
          issuer,
          subject,
          client_id: clientId,
          actor_type: actorType,
        },
        user_metadata: {
          email,
          email_verified: true,
          given_name: "Synthetic",
          family_name: "Integration",
        },
      }],
    });
    authIdentityIds.push(identity.id);
    return { id: identity.id, entityId: identityEntityId };
  }

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (path.startsWith("/store/") && publishableApiKey) {
      headers.set("x-publishable-api-key", publishableApiKey);
    }
    return fetch(new URL(path, requestBase), {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  }

  async function createToken(
    actorType: ActorType,
    actorId: string,
    authIdentityId: string,
    provider: string,
    appMetadata: Record<string, unknown> = {},
  ): Promise<string> {
    const http = (config as { projectConfig: { http: { jwtSecret: string; jwtExpiresIn?: string } } }).projectConfig.http;
    return generateJwtToken({
      actor_id: actorId,
      actor_type: actorType,
      auth_identity_id: authIdentityId,
      auth_provider: provider,
      mfa_enabled: false,
      mfa_challenge_completed_at: null,
      app_metadata: { [`${actorType}_id`]: actorId, ...appMetadata },
      user_metadata: {},
    }, { secret: http.jwtSecret, expiresIn: "5m" });
  }

  let integrationFailure: unknown;
  let cleanupFailure: unknown;
  try {
    const employeeEmail = `employee-${suffix}@integration.invalid`;
    const employee = await users.createUsers({
      email: employeeEmail,
      first_name: "Synthetic",
      last_name: "Employee",
    });
    userIds.push(employee.id);
    const oldIntegrationKeys = await apiKeys.listApiKeys({ type: "publishable" }, { take: 1000 });
    for (const oldKey of oldIntegrationKeys) {
      const oldSuffix = /^integration-([a-f0-9]{24})$/.exec(oldKey.title)?.[1];
      if (!oldSuffix) continue;
      const owner = await users.listUsers({ email: `employee-${oldSuffix}@integration.invalid` }, { take: 1 });
      if (owner.length) continue;
      await apiKeys.revoke(oldKey.id, { revoked_by: employee.id });
      await apiKeys.deleteApiKeys([oldKey.id]);
    }
    const publishableKey = await apiKeys.createApiKeys({
      title: `integration-${suffix}`,
      type: "publishable",
      created_by: employee.id,
    });
    apiKeyIds.push(publishableKey.id);
    publishableApiKey = publishableKey.token;

    assert.equal((await request("/store/customers/me")).status, 401, "anonymous customer profile must be denied");
    assert.equal((await request("/admin/users/me")).status, 401, "anonymous admin profile must be denied");

    const adminLoginPage = await request("/app/login");
    assert.equal(adminLoginPage.status, 200, "the Admin login page must be served");
    assert.equal(adminLoginPage.headers.get("content-security-policy"), "frame-ancestors 'none'",
      "the Medusa backend must prevent the Admin app from being framed");
    assert.equal(adminLoginPage.headers.get("x-frame-options"), "DENY");
    assert.equal(adminLoginPage.headers.get("x-content-type-options"), "nosniff");
    assert.equal(adminLoginPage.headers.get("referrer-policy"), "no-referrer");

    const browserProof = randomBytes(32).toString("base64url");
    const authStart = await request("/auth/customer/encvoy-customer", {
      method: "POST",
      headers: {
        origin: browserOrigin,
        cookie: `encvoy_customer_browser=${browserProof}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const renewedBrowserCookie = authStart.headers.get("set-cookie") ?? "";
    const renewedProof = /(?:^|,\s*)encvoy_customer_browser=([^;,]+)/.exec(renewedBrowserCookie)?.[1];
    assert.equal(renewedProof === browserProof, true,
      "a valid existing browser-proof cookie must be reissued on every auth start");
    assert.equal(/Max-Age=600/i.test(renewedBrowserCookie), true,
      "a reissued browser-proof cookie must receive a fresh ten-minute lifetime");

    const customerEmail = `medusa-encvoy-${suffix}@integration.invalid`;
    const customerIdentity = await createIdentity("customer", `subject-customer-${suffix}`, customerEmail);
    const concurrentCustomers = await Promise.all(
      Array.from({ length: 8 }, () => completeCustomer(container, customerIdentity.id)),
    );
    assert.equal(new Set(concurrentCustomers.map((customer) => customer.id)).size, 1,
      "parallel completion must resolve to one Medusa customer");
    const customer = concurrentCustomers[0];
    customerIds.push(customer.id);
    const repeatedCustomer = await completeCustomer(container, customerIdentity.id);
    assert.equal(repeatedCustomer.id, customer.id, "a repeat login must reuse the linked customer");
    const matchingCustomers = await customers.listCustomers({ email: { $ilike: customerEmail } }, { take: 10 });
    assert.equal(matchingCustomers.length, 1, "parallel and repeated completion must not create duplicates");

    const conflictEmail = `medusa-encvoy-conflict-${suffix}@integration.invalid`;
    const preexistingCustomer = await customers.createCustomers({
      email: conflictEmail,
      first_name: "Existing",
      last_name: "Synthetic",
      has_account: false,
    });
    customerIds.push(preexistingCustomer.id);
    const conflictIdentity = await createIdentity(
      "customer",
      `subject-conflict-${suffix}`,
      conflictEmail.toUpperCase(),
    );
    await assert.rejects(
      completeCustomer(container, conflictIdentity.id),
      (error: unknown) => error instanceof Error && error.message.includes("account_conflict"),
      "an existing email must require manual ownership verification and must not be linked",
    );
    const conflictIdentityAfter = await auth.retrieveAuthIdentity(conflictIdentity.id);
    assert.equal(conflictIdentityAfter.app_metadata?.customer_id, undefined,
      "email collision must not attach the existing customer to the new identity");
    assert.equal((await customers.retrieveCustomer(preexistingCustomer.id)).email, conflictEmail,
      "the pre-existing customer must remain intact");

    const secondCustomerEmail = `medusa-encvoy-second-${suffix}@integration.invalid`;
    const secondCustomerIdentity = await createIdentity(
      "customer",
      `subject-second-customer-${suffix}`,
      secondCustomerEmail,
    );
    const secondCustomer = await completeCustomer(container, secondCustomerIdentity.id);
    customerIds.push(secondCustomer.id);

    const userActorIdentity = await createIdentity("user", `subject-user-actor-${suffix}`, `user-actor-${suffix}@integration.invalid`);
    await assert.rejects(
      completeCustomer(container, userActorIdentity.id),
      (error: unknown) => error instanceof Error && error.message.includes("invalid_customer_identity"),
      "a user identity must not be converted to a customer",
    );
    const crossLinkedIdentity = await createIdentity(
      "customer",
      `subject-cross-linked-${suffix}`,
      `cross-linked-${suffix}@integration.invalid`,
      { user_id: `synthetic-user-${suffix}` },
    );
    await assert.rejects(
      completeCustomer(container, crossLinkedIdentity.id),
      (error: unknown) => error instanceof Error && error.message.includes("invalid_customer_identity"),
      "a customer completion must reject an identity that has an admin user binding",
    );

    const employeeIdentity = await createIdentity(
      "user",
      `subject-authorized-employee-${suffix}`,
      employeeEmail,
      { user_id: employee.id },
    );
    const grants = stateStore();
    await grants.initialize();
    const activeLoginId = `integration-active-${suffix}`;
    await grants.createEmployeeGrant(activeLoginId, employee.id, 300);
    const storedEmployeeIdentity = await auth.retrieveAuthIdentity(employeeIdentity.id, {
      relations: ["provider_identities"],
    });
    assert.equal(storedEmployeeIdentity.app_metadata?.user_id, employee.id,
      "admin access must be attached to the explicit employee binding");
    assert.equal(storedEmployeeIdentity.app_metadata?.customer_id, undefined,
      "an employee identity must not also be a customer identity");

    const customerToken = await createToken("customer", customer.id, customerIdentity.id, "encvoy-customer");
    const invalidOrigin = await request("/auth/session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        origin: `${browserOrigin}.invalid`,
      },
    });
    assert.equal(invalidOrigin.status, 403, "session creation must reject a valid customer token from an untrusted origin");
    assert.equal((await request("/store/customers/me", {
      headers: { authorization: `Bearer ${customerToken}` },
    })).status, 200, "a native Medusa customer token must access the customer profile");
    assert.equal((await request("/admin/users/me", {
      headers: { authorization: `Bearer ${customerToken}` },
    })).status, 401, "a customer token must not access the admin API");

    const employeeToken = await createToken("user", employee.id, employeeIdentity.id, "encvoy-user", {
      encvoy_login_id: activeLoginId,
    });
    assert.equal((await request("/admin/users/me", {
      headers: { authorization: `Bearer ${employeeToken}` },
    })).status, 200, "a pre-bound employee's native Medusa token must access the admin API");
    assert.equal((await request("/store/customers/me", {
      headers: { authorization: `Bearer ${employeeToken}` },
    })).status, 401, "an admin user token must not access the customer API");

    const establishEmployeeSession = await request("/auth/session", {
      method: "POST",
      headers: { authorization: `Bearer ${employeeToken}`, origin: browserOrigin },
    });
    assert.equal(establishEmployeeSession.status, 200,
      "Medusa must convert the employee bearer token into an Admin browser session");
    const employeeSetCookie = establishEmployeeSession.headers.get("set-cookie");
    assert.ok(employeeSetCookie, "employee session establishment must return a session cookie");
    employeeSessionCookie = employeeSetCookie.split(";", 1)[0];
    assert.equal((await request("/admin/users/me", { headers: { cookie: employeeSessionCookie } })).status, 200,
      "the employee browser session must authorize Admin routes");
    const employeeLogout = await request("/auth/session", {
      method: "DELETE",
      headers: { cookie: employeeSessionCookie, origin: browserOrigin },
    });
    assert.equal(employeeLogout.status, 200, "employee logout must destroy its Medusa session");
    assert.equal(await grants.isEmployeeGrantActive(activeLoginId, employee.id), false,
      "employee logout must revoke the server-side grant associated with that browser session");
    assert.equal((await request("/admin/users/me", {
      headers: { authorization: `Bearer ${employeeToken}` },
    })).status, 401, "the copied employee JWT must stop working after browser logout");
    employeeSessionCookie = undefined;

    const establishSession = await request("/auth/session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        origin: browserOrigin,
      },
    });
    assert.equal(establishSession.status, 200, "Medusa must convert the customer bearer token into a native session");
    const setCookie = establishSession.headers.get("set-cookie");
    assert.ok(setCookie, "session establishment must return a session cookie");
    sessionCookie = setCookie.split(";", 1)[0];
    assert.equal((await request("/store/customers/me", { headers: { cookie: sessionCookie } })).status, 200,
      "the native customer session must authorize customer routes");
    assert.equal((await request("/admin/users/me", { headers: { cookie: sessionCookie } })).status, 401,
      "the customer session must not authorize admin routes");

    const revokedLoginId = `integration-revoked-${suffix}`;
    await grants.createEmployeeGrant(revokedLoginId, employee.id, 300);
    assert.equal(await grants.revokeEmployeeGrants(employee.id), 1,
      "the remaining active employee grant must be revoked before checking the copied JWT");
    const revokedEmployeeToken = await createToken(
      "user", employee.id, employeeIdentity.id, "encvoy-user", { encvoy_login_id: revokedLoginId },
    );
    const revokedWithCustomerCookie = await request("/admin/users/me", {
      headers: { authorization: `Bearer ${revokedEmployeeToken}`, cookie: sessionCookie },
    });
    assert.equal(revokedWithCustomerCookie.status, 401,
      "a customer session must not bypass revocation of the supplied employee JWT");
    const revokedWithoutCustomerCookie = await request("/admin/users/me", {
      headers: { authorization: `Bearer ${revokedEmployeeToken}` },
    });
    assert.equal(revokedWithoutCustomerCookie.status, 401,
      "the revoked employee JWT must be rejected without a customer session too");
    const blockedLogout = await request("/auth/session", {
      method: "DELETE",
      headers: { cookie: sessionCookie, origin: `${browserOrigin}.invalid` },
    });
    assert.equal(blockedLogout.status, 403, "logout must reject a request from an untrusted origin");
    assert.equal((await request("/store/customers/me", { headers: { cookie: sessionCookie } })).status, 200,
      "a rejected cross-site logout must leave the current session intact");

    const switchToken = await createToken("customer", secondCustomer.id, secondCustomerIdentity.id, "encvoy-customer");
    const refreshResponse = await request("/auth/token/refresh", {
      method: "POST",
      headers: {
        authorization: `Bearer ${switchToken}`,
        cookie: sessionCookie,
        origin: browserOrigin,
      },
    });
    assert.equal(refreshResponse.status, 401,
      "Envcoy customer JWT refresh must be refused even when an older session cookie is present");
    const refreshError = await refreshResponse.json() as { message?: string };
    assert.equal(refreshError.message, "reauthentication_required");

    const switchSession = await request("/auth/session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${switchToken}`,
        cookie: sessionCookie,
        origin: browserOrigin,
      },
    });
    assert.equal(switchSession.status, 200, "session establishment must accept the newly authenticated customer");
    const switchedSetCookie = switchSession.headers.get("set-cookie");
    assert.ok(switchedSetCookie, "switching the active account must issue a fresh session cookie");
    const previousCookie = sessionCookie;
    sessionCookie = switchedSetCookie.split(";", 1)[0];
    assert.equal(sessionCookie !== previousCookie, true, "switching accounts must regenerate the session identifier");
    const switchedProfile = await request("/store/customers/me", { headers: { cookie: sessionCookie } });
    assert.equal(switchedProfile.status, 200);
    const switchedProfileBody = await switchedProfile.json() as { customer?: { id?: string } };
    assert.equal(switchedProfileBody.customer?.id, secondCustomer.id,
      "the regenerated session must belong to the newly selected customer");
    assert.equal((await request("/store/customers/me", { headers: { cookie: previousCookie } })).status, 401,
      "the replaced session must no longer authorize the previous customer");

    const logout = await request("/auth/session", {
      method: "DELETE",
      headers: { cookie: sessionCookie, origin: browserOrigin },
    });
    assert.equal(logout.status, 200, "local Medusa logout must destroy the session");
    assert.equal((await request("/store/customers/me", { headers: { cookie: sessionCookie } })).status, 401,
      "the destroyed session must no longer authorize customer routes");
    sessionCookie = undefined;

    console.log("Medusa integration passed: concurrent customer provisioning, collision refusal, actor isolation, employee grant revocation on logout, revoked-token denial (including a customer cookie with a revoked employee JWT), browser-cookie renewal, account switching, HTTP protections, and local logout.");
  } catch (error) {
    integrationFailure = error;
  } finally {
    if (sessionCookie) {
      await request("/auth/session", {
        method: "DELETE",
        headers: { cookie: sessionCookie, origin: browserOrigin },
      }).catch(() => undefined);
    }
    if (employeeSessionCookie) {
      await request("/auth/session", {
        method: "DELETE",
        headers: { cookie: employeeSessionCookie, origin: browserOrigin },
      }).catch(() => undefined);
    }
    const cleanup = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupFailure ??= error;
      }
    };
    for (const id of customerIds) await cleanup(() => customers.deleteCustomers([id]));
    for (const id of authIdentityIds) await cleanup(() => auth.deleteAuthIdentities([id]));
    for (const id of apiKeyIds) {
      await cleanup(() => apiKeys.revoke(id, { revoked_by: userIds[0] }));
      await cleanup(() => apiKeys.deleteApiKeys([id]));
    }
    for (const id of userIds) await cleanup(() => users.deleteUsers([id]));
    await cleanup(() => stateStore().close());
  }
  if (integrationFailure) throw integrationFailure;
  if (cleanupFailure) throw cleanupFailure;
}
