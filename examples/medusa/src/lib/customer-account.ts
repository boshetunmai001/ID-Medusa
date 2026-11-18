import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows";
import type { EncvoyStateStore } from "medusa-plugin-encvoy-id";
import { stateStore } from "./state-store";

export async function completeCustomer(
  container: MedusaContainer,
  authIdentityId: string,
  store: Pick<EncvoyStateStore, "withLock"> = stateStore(),
) {
  const auth = container.resolve(Modules.AUTH);
  const customers = container.resolve(Modules.CUSTOMER);
  return store.withLock(`customer-identity:${authIdentityId}`, async () => {
    const identity = await auth.retrieveAuthIdentity(authIdentityId, { relations: ["provider_identities"] });
    const provider = identity.provider_identities?.find((entry) => entry.provider === "encvoy-customer");
    if (!provider || identity.app_metadata?.user_id || provider.provider_metadata?.actor_type !== "customer") {
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "invalid_customer_identity");
    }
    const customerId = identity.app_metadata?.customer_id;
    if (typeof customerId === "string" && customerId) return customers.retrieveCustomer(customerId);

    const claims = provider.user_metadata;
    if (claims?.email_verified !== true || typeof claims.email !== "string") {
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "verified_email_required");
    }
    const email = claims.email.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid_email");
    }
    return store.withLock(`customer-email:${email}`, async () => {
      const escapedEmail = email.replace(/[\\%_]/g, "\\$&");
      const existing = await customers.listCustomers({ email: { $ilike: escapedEmail } }, { take: 1 });
      if (existing.length) {
        throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "account_conflict: Contact the store administrator to verify ownership. Automatic linking is disabled.");
      }
      const { result } = await createCustomerAccountWorkflow(container).run({
        input: {
          authIdentityId,
          customerData: {
            email,
            first_name: typeof claims.given_name === "string" ? claims.given_name.slice(0, 100) : undefined,
            last_name: typeof claims.family_name === "string" ? claims.family_name.slice(0, 100) : undefined,
          },
        },
      });
      return result;
    });
  });
}
