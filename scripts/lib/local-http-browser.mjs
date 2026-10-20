// HTTP-only acceptance-test client. This is not used by the provider or storefront.
// Keep cookies in memory and stop redirects before the browser callback executes.
export class LocalHttpBrowser {
  cookies = new Map();

  clone() {
    const copy = new LocalHttpBrowser();
    copy.cookies = new Map(this.cookies);
    return copy;
  }

  async request(address, { method = "GET", json, form, token } = {}) {
    const url = new URL(address);
    if (url.protocol !== "http:" || url.hostname !== "localhost" || !["9000", "9090"].includes(url.port)) {
      throw new Error("Acceptance client refused a non-local destination.");
    }
    const headers = {};
    const values = [];
    for (const cookie of this.cookies.values()) {
      if (cookie.expires <= Date.now() || cookie.secure) continue;
      if (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")) {
        values.push(`${cookie.name}=${cookie.value}`);
      }
    }
    if (values.length) headers.cookie = values.join("; ");
    if (method !== "GET") headers.origin = url.origin;
    if (token) headers.authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const response = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(15000) });
    for (const raw of response.headers.getSetCookie()) {
      const parts = raw.split(";").map((part) => part.trim());
      const separator = parts[0].indexOf("=");
      if (separator < 1) continue;
      const attributes = new Map(parts.slice(1).map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part.toLowerCase(), ""] : [part.slice(0, index).toLowerCase(), part.slice(index + 1)];
      }));
      const domain = attributes.get("domain");
      if (domain && domain.replace(/^\./, "").toLowerCase() !== url.hostname) continue;
      const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
      const cookie = {
        name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1),
        path: attributes.get("path") || defaultPath, secure: attributes.has("secure"), expires: Infinity,
      };
      if (attributes.has("expires")) cookie.expires = Date.parse(attributes.get("expires"));
      if (attributes.has("max-age")) cookie.expires = Date.now() + Number(attributes.get("max-age")) * 1000;
      const key = `${cookie.path}\0${cookie.name}`;
      if (cookie.expires <= Date.now()) this.cookies.delete(key);
      else this.cookies.set(key, cookie);
    }
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { /* HTML responses are expected during login. */ }
    return { status: response.status, headers: response.headers, text, data, url };
  }

  async follow(address) {
    let url = new URL(address);
    for (let count = 0; count < 16; count++) {
      if (url.origin === "http://localhost:9000" && ["/demo/callback", "/app/login"].includes(url.pathname)) {
        return { callback: url };
      }
      const response = await this.request(url);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
      } else {
        return response;
      }
    }
    throw new Error("Acceptance client exceeded the local redirect limit.");
  }
}

export class LocalCheckError extends Error {}

export function requireCheck(condition, label) {
  // Never include response bodies, URLs with queries, tokens, or credentials.
  if (!condition) throw new LocalCheckError(label);
}
