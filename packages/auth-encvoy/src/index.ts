import { Modules } from "@medusajs/framework/utils"
import { ModuleProvider } from "@medusajs/framework/utils"
import { EncvoyAuthProvider } from "./services/encvoy-auth.js"

export { EncvoyAuthProvider } from "./services/encvoy-auth.js"
export { EncvoyStateStore } from "./store.js"
export type { EncvoyLoginState } from "./store.js"
export { entityId } from "./services/encvoy-auth.js"
export type {
  EncvoyActorType,
  EncvoyAuthProviderOptions,
} from "./options.js"

export default ModuleProvider(Modules.AUTH, {
  services: [EncvoyAuthProvider],
})
