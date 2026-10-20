import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { completeCustomer } from "../../../../lib/customer-account";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (req.auth_context.auth_provider !== "encvoy-customer") return res.status(403).json({ message: "invalid_provider" });
  const customer = await completeCustomer(req.scope, req.auth_context.auth_identity_id);
  res.setHeader("Cache-Control", "no-store");
  res.json({ customer: { id: customer.id, email: customer.email, first_name: customer.first_name, last_name: customer.last_name } });
}
