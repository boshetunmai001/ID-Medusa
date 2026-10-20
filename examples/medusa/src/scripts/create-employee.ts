import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export default async function createEmployee({ container }: ExecArgs) {
  const email = process.env.EMPLOYEE_EMAIL;
  if (!email || !email.endsWith(".invalid")) throw new Error("This demo command accepts only synthetic .invalid email addresses.");
  const users = container.resolve(Modules.USER);
  const existing = await users.listUsers({ email });
  const user = existing[0] ?? await users.createUsers({ email, first_name: "Test", last_name: "Employee" });
  console.log(`Employee ID: ${user.id}. This does not authorize Encvoy login; run allow-employee separately.`);
}
