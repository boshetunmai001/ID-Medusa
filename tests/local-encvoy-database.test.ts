import assert from "node:assert/strict"
import test from "node:test"
import { assertLocalEncvoyDatabase } from "../scripts/lib/local-encvoy-database.mjs"

test("source Encvoy migrations accept only the dedicated local database", () => {
  assert.doesNotThrow(() => assertLocalEncvoyDatabase("postgresql://medusa:secret@127.0.0.1:55433/encvoy_source"))
  assert.doesNotThrow(() => assertLocalEncvoyDatabase("postgres://medusa:secret@[::1]:55433/encvoy_source"))

  for (const target of [
    "postgresql://user:secret@db.example:55432/encvoy",
    "postgresql://user:secret@127.0.0.1:55439/encvoy",
    "postgresql://user:secret@127.0.0.1:55432/encvoy",
    "postgresql://user:secret@127.0.0.1:55432/medusa",
    "postgresql://user:secret@127.0.0.1:55433/encvoy",
    "postgresql://user:secret@127.0.0.1:55432/encvoy?host=db.example",
    "mysql://user:secret@127.0.0.1:55432/encvoy",
  ]) {
    assert.throws(() => assertLocalEncvoyDatabase(target), /Refusing Encvoy source migrations/)
  }
})
