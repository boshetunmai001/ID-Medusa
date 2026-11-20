import { LocalCheckError } from "./local-http-browser.mjs";

function sameValues(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const sortedExpected = [...expected].sort();
  return [...actual].sort().every((value, index) => value === sortedExpected[index]);
}

export function parseClientList(result) {
  const items = Array.isArray(result) ? result : result?.items ?? result?.data ?? result?.clients;
  if (!Array.isArray(items)) {
    throw new LocalCheckError("The Encvoy client list returned an unsupported response.");
  }

  const total = Array.isArray(result) ? undefined : result.totalCount ?? result.total_count ?? result.count;
  if (total !== undefined && !(Number.isFinite(Number(total)) && Number(total) <= items.length)) {
    throw new LocalCheckError("The Encvoy client list was incomplete.");
  }
  if (items.length >= 100) {
    throw new LocalCheckError("The Encvoy client list may be incomplete.");
  }
  return items;
}

export function findRecoveryCandidate(items, names) {
  if (!Array.isArray(items)) {
    throw new LocalCheckError("The Encvoy client list returned an unsupported response.");
  }
  const candidates = items.filter((client) => client && names.includes(client.name));
  if (candidates.length > 1) {
    throw new LocalCheckError("Several applications match the saved creation intent; refusing ambiguous recovery.");
  }
  if (candidates.length === 0) return undefined;

  const candidate = candidates[0];
  if (typeof candidate.client_id !== "string" || candidate.client_id.length === 0) {
    throw new LocalCheckError("The matching application list entry has no client ID.");
  }
  return candidate;
}

export function clientMatches(client, expected, names = [expected.name]) {
  return Boolean(client && (names === null || names.includes(client.name)) && client.domain === expected.domain &&
    sameValues(client.redirect_uris, expected.redirect_uris) &&
    sameValues(client.grant_types, expected.grant_types) &&
    sameValues(client.response_types, expected.response_types) &&
    client.token_endpoint_auth_method === expected.token_endpoint_auth_method &&
    client.introspection_endpoint_auth_method === expected.introspection_endpoint_auth_method &&
    client.revocation_endpoint_auth_method === expected.revocation_endpoint_auth_method &&
    client.id_token_signed_response_alg === expected.id_token_signed_response_alg &&
    client.subject_type === expected.subject_type &&
    typeof client.client_secret === "string" && client.client_secret.length > 0);
}

export function recoveredClientMatches(candidate, detail, expected, names) {
  return Boolean(candidate && detail?.client_id === candidate.client_id &&
    clientMatches(detail, expected, names));
}
