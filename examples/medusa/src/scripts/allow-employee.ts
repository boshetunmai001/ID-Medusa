import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { entityId } from "medusa-plugin-encvoy-id";
import { stateStore } from "../lib/state-store";

// Run only from a trusted server shell after verifying the issuer and subject.
export default async function allowEmployee({ container }: ExecArgs) {
  const userId = process.env.EMPLOYEE_MEDUSA_USER_ID;
  const subject = process.env.EMPLOYEE_ENCVOY_SUBJECT;
  const issuer = process.env.ENCVOY_ISSUER!;
  const clientId = process.env.ENCVOY_USER_CLIENT_ID!;
  if (!userId || !subject) throw new Error("Set EMPLOYEE_MEDUSA_USER_ID and EMPLOYEE_ENCVOY_SUBJECT after verifying ownership.");
  const user = await container.resolve(Modules.USER).retrieveUser(userId);
  const auth = container.resolve(Modules.AUTH);
  const key = entityId(issuer, subject, clientId, "user");
  await stateStore().initialize();
  await stateStore().withLock(`employee-binding:${key}`, async () => {
    const existing = await auth.listAuthIdentities({ provider_identities: { provider: "encvoy-user", entity_id: key } }, { relations: ["provider_identities"] });
    if (existing.length) {
      if (existing.length !== 1 || existing[0].app_metadata?.user_id !== user.id || existing[0].app_metadata?.customer_id) throw new Error("Identity is already bound. Refusing to overwrite it.");
      console.log("Employee binding already exists; no changes made.");
      return;
    }
    await auth.createAuthIdentities({
      app_metadata: { user_id: user.id },
      provider_identities: [{
        provider: "encvoy-user",
        entity_id: key,
        provider_metadata: { issuer, subject, client_id: clientId, actor_type: "user" },
      }],
    });
    console.log("Created the explicit employee binding.");
  });
  await stateStore().close();
}
