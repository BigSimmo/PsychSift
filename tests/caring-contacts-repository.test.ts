// tests/caring-contacts-repository.test.ts
//
// The shared store contract, run against the in-memory implementation.
// tests/caring-contacts-postgres-repository.test.ts calls the same function with the Postgres
// factory, so neither store can drift from the other's behaviour.
//
// This file holds nothing else, and that is the point. Task 10's behavioural tests for the storage
// extension were written here, against `createInMemoryRepository` directly, which held exactly ONE
// store to them; Task 11b moved every one of them into the shared contract, where both stores
// answer for them. Nothing was left behind -- not one of those assertions reached into an in-memory
// internal, so not one of them needed to stay. Add a new behavioural test to the contract helper,
// never here.
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";

import { describeCaringContactRepositoryContract } from "./helpers/caring-contacts-repository-contract";

describeCaringContactRepositoryContract("in-memory", createInMemoryRepository);
