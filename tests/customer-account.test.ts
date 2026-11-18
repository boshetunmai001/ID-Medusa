import assert from "node:assert/strict"
import test from "node:test"
import { Modules } from "@medusajs/framework/utils"
import { completeCustomer } from "../examples/medusa/src/lib/customer-account.js"

function setup(
  identity: Record<string, any>,
  existingCustomers: Array<Record<string, unknown>> = [],
) {
  const locks: string[] = []
  const retrievedCustomerIds: string[] = []
  const auth = {
    async retrieveAuthIdentity(id: string) {
      assert.equal(id, "auth_synthetic")
      return identity
    },
  }
  const customers = {
    async retrieveCustomer(id: string) {
      retrievedCustomerIds.push(id)
      return { id }
    },
    async listCustomers(filter: Record<string, any>) {
      return existingCustomers.filter((customer) =>
        customer.email === filter.email.$ilike,
      )
    },
  }
  const container = {
    resolve(module: string) {
      if (module === Modules.AUTH) return auth
      if (module === Modules.CUSTOMER) return customers
      throw new Error("unexpected module")
    },
  }
  const store = {
    async withLock<T>(key: string, action: () => Promise<T>) {
      locks.push(key)
      return action()
    },
  }
  return {
    container: container as never,
    store: store as never,
    locks,
    retrievedCustomerIds,
  }
}

test("completeCustomer returns the already-linked customer without provisioning again", async () => {
  const state = setup({
    app_metadata: { customer_id: "cus_existing" },
    provider_identities: [{
      provider: "encvoy-customer",
      provider_metadata: { actor_type: "customer" },
    }],
  })
  assert.deepEqual(
    await completeCustomer(state.container, "auth_synthetic", state.store),
    { id: "cus_existing" },
  )
  assert.deepEqual(state.retrievedCustomerIds, ["cus_existing"])
  assert.deepEqual(state.locks, ["customer-identity:auth_synthetic"])
})

test("completeCustomer rejects non-customer identities and unverified email", async () => {
  const userIdentity = setup({
    app_metadata: { user_id: "usr_employee" },
    provider_identities: [{
      provider: "encvoy-customer",
      provider_metadata: { actor_type: "customer" },
    }],
  })
  await assert.rejects(
    completeCustomer(userIdentity.container, "auth_synthetic", userIdentity.store),
    /invalid_customer_identity/,
  )

  const unverifiedIdentity = setup({
    app_metadata: {},
    provider_identities: [{
      provider: "encvoy-customer",
      provider_metadata: { actor_type: "customer" },
      user_metadata: { email: "alice@example.test", email_verified: false },
    }],
  })
  await assert.rejects(
    completeCustomer(unverifiedIdentity.container, "auth_synthetic", unverifiedIdentity.store),
    /verified_email_required/,
  )
})

test("completeCustomer refuses an existing email instead of linking or overwriting it", async () => {
  const state = setup({
    app_metadata: {},
    provider_identities: [{
      provider: "encvoy-customer",
      provider_metadata: { actor_type: "customer" },
      user_metadata: { email: " Alice@Example.test ", email_verified: true },
    }],
  }, [{ id: "cus_guest", email: "alice@example.test" }])

  await assert.rejects(
    completeCustomer(state.container, "auth_synthetic", state.store),
    /account_conflict/,
  )
  assert.deepEqual(state.locks, [
    "customer-identity:auth_synthetic",
    "customer-email:alice@example.test",
  ])
  assert.deepEqual(state.retrievedCustomerIds, [])
})
