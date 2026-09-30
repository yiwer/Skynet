export type TaskRegistration = {
  state: string; adapter: string; taskName?: string; command?: string;
  arguments?: string; description?: string; checkedAt: string;
  error?: string; lifecycle: Record<string, string>;
  fallback?: { observedAt: string; notice: string };
};
type Actions = {
  task: (mode: 'register' | 'remove', registration: TaskRegistration) => Promise<unknown>;
  save: (registration: TaskRegistration) => Promise<unknown>;
};
const blocked = 'Windows user task registration was blocked or conflicts with an existing task. Collection can run in this login session. Inspect Task Scheduler permissions and rerun skynet setup; no elevation or policy change is required by Skynet.';

// Persist only after the OS verifies ownership. In particular, a changed task
// must not destroy the previous metadata needed to inspect/remove its owner.
export async function registerTask(previous: TaskRegistration | null, next: TaskRegistration,
  legacyArguments: string, actions: Actions): Promise<TaskRegistration> {
  try {
    if (previous && previous.taskName === next.taskName && previous.arguments !== next.arguments) {
      if (previous.adapter !== 'windows-user-task' || previous.command !== next.command ||
        previous.description !== next.description || previous.arguments !== legacyArguments) {
        throw new Error('Unrecognized previous task action; registration retained');
      }
      // This operation independently verifies the exact old action, current
      // user's SID and Limited privilege before removing anything. First
      // accept an exact new action left by a crash before metadata commit.
      try { await actions.task('register', next); }
      catch {
        await actions.task('remove', previous);
        await actions.task('register', next);
      }
    } else {
      await actions.task('register', next);
    }
  } catch {
    // An existing record remains byte-for-byte unchanged on an OS conflict.
    // Return the degraded observation without claiming it was persisted.
    if (previous) return { ...previous, state: 'degraded', error: blocked };
    const degraded = { ...next, state: 'degraded', error: blocked };
    await actions.save(degraded);
    return degraded;
  }
  // A persistence error must remain an error, not a successful degraded result.
  // The next repair can recognize the exact new OS action before replacing it.
  const registered = { ...next, state: 'registered' };
  await actions.save(registered);
  return registered;
}
