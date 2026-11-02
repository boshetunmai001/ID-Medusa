import { EncvoyStateStore } from "medusa-plugin-encvoy-id";

let store: EncvoyStateStore | undefined;
export function stateStore(): EncvoyStateStore {
  return store ??= new EncvoyStateStore(process.env.DATABASE_URL!);
}
