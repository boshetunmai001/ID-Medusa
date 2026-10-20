type UserAuthPath = "/auth/user/encvoy-user" | "/auth/user/encvoy-user/callback";

export async function postEncvoyUserAuth<T>(path: UserAuthPath, body: Record<string, string>): Promise<T> {
  try {
    // The Medusa SDK forces credentials to "omit" for JWT auth, which drops the HttpOnly browser-proof cookie.
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error();
    return await response.json() as T;
  } catch {
    throw new Error("Encvoy sign-in request failed.");
  }
}
