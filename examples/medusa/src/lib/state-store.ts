import { EncvoyStateStore } from "@local/medusa-auth-encvoy";

let store: EncvoyStateStore | undefined;
export function stateStore(): EncvoyStateStore {
  return store ??= new EncvoyStateStore(process.env.DATABASE_URL!);
}
