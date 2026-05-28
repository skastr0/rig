import { Deferred, Effect, Ref } from "effect";

type GroupLock = Deferred.Deferred<void>;

type LockResult = { type: "wait"; lock: GroupLock } | { type: "acquired"; lock: GroupLock };

export const acquireGroupLock = (
  group: string | undefined,
  groupLocks: Ref.Ref<Map<string, GroupLock>>,
): Effect.Effect<GroupLock | null> =>
  Effect.gen(function* () {
    if (!group) return null;

    const lock = yield* Deferred.make<void>();
    const result: LockResult = yield* Ref.modify(groupLocks, (locks) => {
      const existingLock = locks.get(group);
      if (existingLock) {
        return [{ type: "wait", lock: existingLock } as LockResult, locks] as const;
      }

      return [{ type: "acquired", lock } as LockResult, new Map(locks).set(group, lock)] as const;
    });

    if (result.type === "wait") {
      yield* Deferred.await(result.lock);
      return yield* acquireGroupLock(group, groupLocks);
    }

    return result.lock;
  });

export const releaseGroupLock = (
  group: string | undefined,
  lock: GroupLock | null,
  groupLocks: Ref.Ref<Map<string, GroupLock>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!group || !lock) return;

    yield* Ref.update(groupLocks, (locks) => {
      const nextLocks = new Map(locks);
      if (nextLocks.get(group) === lock) {
        nextLocks.delete(group);
      }
      return nextLocks;
    });

    yield* Deferred.succeed(lock, undefined);
  });
