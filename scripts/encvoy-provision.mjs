import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restrictFileMode } from "./lib/platform.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const localEnvPath = path.join(root, ".local/encvoy.env");
const clientEnvPath = path.join(root, ".local/encvoy-clients.env");

function parseEnv(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#")) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function encodeEnv(values) {
  return `${Array.from(values, ([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

const env = parseEnv(await readFile(localEnvPath, "utf8"));
const ids = parseEnv(
  await readFile(clientEnvPath, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  }),
);
const required = ["DOMAIN", "ADMIN_LOGIN", "ADMIN_PASSWORD", "CLIENT_ID"];
const missing = required.filter((key) => !env.get(key));
if (missing.length) throw new Error(`Missing stand settings: ${missing.join(", ")}`);
if (env.get("DOMAIN") !== "http://localhost:9090") {
  throw new Error("This provisioner is restricted to the documented localhost Encvoy stand.");
}

const api = new URL("http://127.0.0.1:3005/api/v1/");
const authorization = `Basic ${Buffer.from(
  `${env.get("ADMIN_LOGIN")}:${env.get("ADMIN_PASSWORD")}`,
).toString("base64")}`;

async function request(endpoint, { method = "GET", body, contentType } = {}) {
  const headers = { authorization, accept: "application/json" };
  let payload;
  if (body !== undefined) {
    headers["content-type"] = contentType || "application/json";
    payload = contentType === "application/x-www-form-urlencoded" ? body.toString() : JSON.stringify(body);
  }
  const response = await fetch(new URL(endpoint, api), {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed with HTTP ${response.status}; response body suppressed`);
  }
  return data;
}

async function persistClientEnv() {
  const output = new Map();
  for (const key of [
    "ENCVOY_CUSTOMER_CLIENT_ID",
    "ENCVOY_CUSTOMER_CLIENT_SECRET",
    "ENCVOY_USER_CLIENT_ID",
    "ENCVOY_USER_CLIENT_SECRET",
    "ENCVOY_CUSTOMER_SUBJECT",
    "ENCVOY_EMPLOYEE_SUBJECT",
    "ENCVOY_OUTSIDER_SUBJECT",
    "ENCVOY_CUSTOMER_LOGIN",
    "ENCVOY_EMPLOYEE_LOGIN",
    "ENCVOY_OUTSIDER_LOGIN",
    "ENCVOY_CUSTOMER_EMAIL",
    "ENCVOY_EMPLOYEE_EMAIL",
    "ENCVOY_OUTSIDER_EMAIL",
  ]) {
    const value = ids.get(key) ?? env.get(key);
    if (value) output.set(key, value);
  }
  await writeFile(clientEnvPath, encodeEnv(output), { mode: 0o600 });
  await restrictFileMode(clientEnvPath, 0o600);
}

async function saveClient(key, name, callback) {
  const idKey = `${key}_CLIENT_ID`;
  const secretKey = `${key}_CLIENT_SECRET`;
  let clientId = ids.get(idKey);
  let clientSecret = ids.get(secretKey);

  if (clientId) {
    try {
      await request(`clients/${encodeURIComponent(clientId)}`);
    } catch {
      clientId = undefined;
      clientSecret = undefined;
    }
  }

  if (!clientId) {
    const matches = await request(`clients?limit=100&search=${encodeURIComponent(name)}`);
    const candidate = Array.isArray(matches)
      ? matches.find(
          (client) =>
            client.domain === "http://localhost:9000" &&
            client.name &&
            Object.values(client.name).includes(name) &&
            Array.isArray(client.redirect_uris) &&
            client.redirect_uris.includes(callback),
        )
      : undefined;

    if (candidate?.client_id) clientId = candidate.client_id;
  }

  if (!clientId) {
    const response = await request("clients", {
      method: "POST",
      body: {
        name: { "en-US": name, "ru-RU": name },
        domain: "http://localhost:9000",
        redirect_uris: [callback],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        introspection_endpoint_auth_method: "client_secret_basic",
        revocation_endpoint_auth_method: "client_secret_basic",
        id_token_signed_response_alg: "RS256",
      },
    });
    clientId = response?.client_id;
    clientSecret = response?.client_secret;
  } else if (!clientSecret) {
    const response = await request(`clients/${encodeURIComponent(clientId)}/regenerate-secret`, {
      method: "POST",
    });
    clientSecret = response?.client_secret;
  }

  if (!clientId || !clientSecret) {
    throw new Error(`Encvoy did not return client credentials for ${key}`);
  }

  ids.set(idKey, clientId);
  ids.set(secretKey, clientSecret);
  await persistClientEnv();
}

async function createOrReuseUser(role) {
  const prefix = `ENCVOY_${role.toUpperCase()}`;
  const login = env.get(`${prefix}_LOGIN`);
  const password = env.get(`${prefix}_PASSWORD`);
  const email = env.get(`${prefix}_EMAIL`);
  const subjectKey = `${prefix}_SUBJECT`;
  if (!login || !password || !email) throw new Error(`Missing local ${role} fixture settings`);

  const loginExists = await request(`users/is-login-available?login=${encodeURIComponent(login)}`);
  if (loginExists === true || loginExists?.exists === true) {
    const knownSubject = ids.get(subjectKey);
    const userIds = knownSubject ? JSON.stringify([knownSubject]) : undefined;
    const params = new URLSearchParams({ search: login, limit: "100" });
    if (userIds) params.set("user_ids", userIds);
    const result = await request(
      `clients/${encodeURIComponent(env.get("CLIENT_ID"))}/users/autocomplete?${params}`,
    );
    const existing = result?.users?.find((user) => user.login === login);
    if (!existing?.id) {
      throw new Error(
        `Fixture login ${login} already exists but could not be resolved through the Encvoy API`,
      );
    }
    ids.set(subjectKey, existing.id);
    await persistClientEnv();
    return existing.id;
  }

  if (loginExists === false || loginExists?.exists === false) {
    const user = await request("users", {
      method: "POST",
      body: {
        login,
        password,
        email,
        email_verified: true,
        send_account_create_email: false,
        given_name: role[0].toUpperCase() + role.slice(1),
        family_name: "Test",
        nickname: `Local ${role}`,
      },
    });
    if (!user?.id) throw new Error(`Encvoy did not return the ${role} user subject`);
    ids.set(subjectKey, user.id);
    await persistClientEnv();
    return user.id;
  }

  throw new Error(`Encvoy returned an unexpected login existence result for ${login}`);
}

await request("users/me");

// The upstream first-run bootstrap creates a fixed admin/admin account. Replace its
// password through Encvoy's supported user API before creating any test fixtures.
const replacementPassword = env.get("ENCVOY_ADMIN_DECOY_PASSWORD");
if (!replacementPassword) throw new Error("Missing local decoy-admin replacement password");
const seededEditor = await request("users/2");
if (String(seededEditor?.id) !== "2" || seededEditor?.login !== "admin") {
  throw new Error("The local Encvoy seed does not match the expected Editor account; refusing to change its password");
}
const form = new URLSearchParams({ password: replacementPassword });
await request("users/2/password", {
  method: "PUT",
  body: form,
  contentType: "application/x-www-form-urlencoded",
});

await saveClient(
  "ENCVOY_CUSTOMER",
  "Medusa customer browser test",
  "http://localhost:9000/demo/callback",
);
await saveClient(
  "ENCVOY_USER",
  "Medusa employee browser test",
  "http://localhost:9000/app/login",
);

await createOrReuseUser("customer");
await createOrReuseUser("employee");
await createOrReuseUser("outsider");
await persistClientEnv();

console.log("Encvoy fixtures are ready through the local Encvoy API.");
console.log("Customer and employee clients and synthetic fixtures are ready; identifiers and credentials remain in private .local files.");
