import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { stateStore } from "../lib/state-store";

// Run from a trusted server shell after confirming the Medusa user ID.
export default async function revokeEmployee({ container }: ExecArgs) {
  const userId = process.env.EMPLOYEE_MEDUSA_USER_ID;
  if (!userId) throw new Error("Set EMPLOYEE_MEDUSA_USER_ID to the verified Medusa user ID.");

  const user = await container.resolve(Modules.USER).retrieveUser(userId);
  const store = stateStore();
  try {
    await store.initialize();
    const revoked = await store.revokeEmployeeGrants(user.id);
    console.log(`Revoked ${revoked} active Encvoy employee session grant(s) for Medusa user ${user.id}.`);
  } finally {
    await store.close();
  }
}
