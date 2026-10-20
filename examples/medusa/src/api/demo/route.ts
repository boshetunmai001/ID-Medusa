import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { demoHtml } from "../../lib/demo-html";
export async function GET(_req: MedusaRequest, res: MedusaResponse) { res.type("html").send(demoHtml); }
