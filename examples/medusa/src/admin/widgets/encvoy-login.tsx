import { defineWidgetConfig } from "@medusajs/admin-sdk";
import Medusa from "@medusajs/js-sdk";
import { useEffect, useState } from "react";
import { establishEncvoyAdminSession, postEncvoyUserAuth } from "../lib/encvoy-browser-auth";

const sdk = new Medusa({ baseUrl: "/", debug: false, auth: { type: "session" } });
let callbackPromise: Promise<void> | undefined;

async function finishCallback(params: URLSearchParams): Promise<void> {
  const body: Record<string, string> = {};
  for (const key of ["code", "state", "iss", "error"]) {
    if (params.getAll(key).length > 1) throw new Error("Invalid callback");
    if (params.has(key)) body[key] = params.get(key)!;
  }
  const result = await postEncvoyUserAuth<{ token?: string; mfa_required?: boolean; verification_required?: boolean }>("/auth/user/encvoy-user/callback", body);
  if (typeof result.token !== "string" || result.mfa_required || result.verification_required) throw new Error("Sign-in requires additional verification.");
  // Exchange the callback JWT for an HttpOnly Medusa session. Client.setToken()
  // would only put the JWT in local storage and would not create a session.
  await establishEncvoyAdminSession(result.token);
  await sdk.client.clearToken();
  try {
    await sdk.admin.user.me();
  } catch {
    await sdk.auth.logout();
    throw new Error("This employee is not authorized.");
  }
  window.location.replace("/app");
}

function EncvoyLogin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("state") && !params.has("error") && !params.has("code")) return;
    window.history.replaceState(null, "", window.location.pathname);
    setBusy(true);
    callbackPromise ??= finishCallback(params);
    callbackPromise.catch(() => {
      setMessage("Sign-in failed, expired, or was cancelled. Only pre-authorized employees may sign in. Please try again or contact the administrator.");
      setBusy(false);
    });
  }, []);
  const login = async () => {
    setBusy(true);
    setMessage("");
    callbackPromise = undefined;
    try {
      const result = await postEncvoyUserAuth<{ location: string }>("/auth/user/encvoy-user", {});
      if (typeof result.location !== "string") throw new Error("Encvoy sign-in request failed.");
      window.location.assign(result.location);
    } catch {
      setMessage("Encvoy ID is unavailable. Please try again later.");
      setBusy(false);
    }
  };
  return <div id="encvoy-login" style={{ padding: "16px 0", width: "100%" }}>
    {/* Medusa renders automatic SSO buttons after login.after widgets.
        This example uses its own fixed callback and never invokes that flow.
        Keep this presentation selector under review when upgrading the Admin. */}
    <style>{"#encvoy-login ~ div { display: none; }"}</style>
    <button type="button" onClick={login} disabled={busy} style={{ width: "100%", borderRadius: 8, padding: 12, background: "#173ec4", color: "white", opacity: busy ? 0.6 : 1 }}>
      {busy ? "Signing in…" : "Sign in with Encvoy ID"}
    </button>
    <p style={{ fontSize: 12, marginTop: 8 }}>Access is limited to pre-authorized employees.</p>
    {message && <p role="alert" style={{ fontSize: 13, marginTop: 8 }}>{message}</p>}
  </div>;
}

export const config = defineWidgetConfig({ zone: "login.after" });
export default EncvoyLogin;
