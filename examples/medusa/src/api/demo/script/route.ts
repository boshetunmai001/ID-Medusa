import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { demoScript } from "../../../lib/demo-html";
export async function GET(_req: MedusaRequest, res: MedusaResponse) { res.type("js").send(demoScript); }
