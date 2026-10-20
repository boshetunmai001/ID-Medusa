import { stateStore } from "../lib/state-store";

export default async function initializeEncvoy(): Promise<void> {
  await stateStore().initialize();
}
