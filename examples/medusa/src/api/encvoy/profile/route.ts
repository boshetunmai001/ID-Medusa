import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(req.auth_context.actor_id);
  res.setHeader("Cache-Control", "no-store");
  res.json({ customer: { id: customer.id, email: customer.email, first_name: customer.first_name, last_name: customer.last_name } });
}
