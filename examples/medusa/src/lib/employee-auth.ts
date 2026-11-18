import { authenticate, MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { EncvoyStateStore } from "medusa-plugin-encvoy-id";
import { stateStore } from "./state-store";

/** Check the Encvoy grant after Medusa has resolved a user actor. */
export async function requireActiveEncvoyEmployeeGrant(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
  store: EncvoyStateStore = stateStore(),
) {
  const auth = (req as unknown as { auth_context?: {
    actor_id?: string;
    actor_type?: string;
    auth_provider?: string;
    app_metadata?: Record<string, unknown>;
  } }).auth_context;
  if (auth?.auth_provider !== "encvoy-user") return next();

  const loginId = auth.app_metadata?.encvoy_login_id;
  if (auth.actor_type !== "user" || !auth.actor_id || typeof loginId !== "string") {
    return res.status(401).json({ message: "invalid_employee_token" });
  }

  try {
    await store.initialize();
    if (!await store.isEmployeeGrantActive(loginId, auth.actor_id)) {
      return res.status(401).json({ message: "employee_session_revoked" });
    }
    next();
  } catch {
    // Fail closed: an unavailable grant store must not leave a JWT usable.
    return res.status(503).json({ message: "employee_session_check_unavailable" });
  }
}

/** Revoke the grant attached to the current employee's browser session on logout. */
export async function revokeEncvoyEmployeeGrantOnLogout(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
  store: Pick<EncvoyStateStore, "initialize" | "revokeEmployeeGrant"> = stateStore(),
) {
  const auth = (req as unknown as { auth_context?: {
    actor_id?: string;
    actor_type?: string;
    auth_provider?: string;
    app_metadata?: Record<string, unknown>;
  } }).auth_context;
  if (auth?.auth_provider !== "encvoy-user") return next();

  const loginId = auth.app_metadata?.encvoy_login_id;
  if (auth.actor_type !== "user" || !auth.actor_id || typeof loginId !== "string") {
    return res.status(401).json({ message: "invalid_employee_session" });
  }
  try {
    await store.initialize();
    await store.revokeEmployeeGrant(loginId, auth.actor_id);
    next();
  } catch {
    // Do not destroy the browser session and report success if server-side JWT
    // revocation could not be persisted.
    res.status(503).json({ message: "employee_session_revoke_unavailable" });
  }
}

/** Add to every custom route that accepts an authenticated Medusa user. */
export function activeEncvoyEmployeeRouteMiddlewares() {
  return [
    authenticate("user", ["session", "bearer", "api-key"]),
    requireActiveEncvoyEmployeeGrant,
  ] as const;
}
