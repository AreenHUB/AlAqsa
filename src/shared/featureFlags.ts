// ============================================================================
// AlAqsa — Feature flags.
//
// Flags let a finished but not-yet-wanted feature stay in the codebase, fully
// built and tested, without being reachable in the running app. Nothing is
// deleted, so turning a feature back on is a one-line change rather than a
// rewrite.
// ============================================================================

/**
 * Staff user accounts, per-user sign-in, and the four-role permission system
 * (admin / technician / accountant / viewer).
 *
 * Currently OFF at the owner's request: the shop is small enough that a single
 * shared daily password matches how they actually work, and the extra layer was
 * causing confusion about who could do what.
 *
 * While this is false:
 *   - the Users tab and the session switcher are not rendered;
 *   - `users:*` and `auth:signIn`/`signOut`/`listUsers` IPC channels refuse to
 *     run, so a hidden button or a devtools call cannot reach them either;
 *   - authorisation is decided by which password opened the app, not by a role.
 *
 * Everything needed to switch it back on is still present and compiling:
 * the users repository, the role MATRIX and CHANNEL_CAPS in
 * `main/security/permissions.ts`, the UsersTab, SessionMenu and SignInScreen.
 */
export const USER_ACCOUNTS_ENABLED = false;

/**
 * Channels that require the MASTER password — the owner's secret — rather than
 * merely having the app open with the shared daily password.
 *
 * These are the operations the owner asked to keep to himself: destroying or
 * replacing the data, changing the locks, and changing what this machine is on
 * the network. Everything else is ordinary shop work and needs no extra proof.
 *
 * This list is enforced in the main process (see `assertAllowed`), so hiding
 * the corresponding buttons in the UI is a convenience, not the control.
 */
export const OWNER_ONLY_CHANNELS: readonly string[] = [
  // Destroying or replacing all data
  'backup:factoryReset',
  'backup:restore',
  'app:seedDemoData',
  // Carrying every client's data off the machine in one file
  'backup:exportEncrypted',
  // Changing the locks
  'auth:changePassword',
  'auth:setDailyPassword',
  'auth:clearDailyPassword',
  'auth:regenerateRecoveryKey',
  // Changing this machine's role on the shop network
  'network:setHost',
  'network:connect',
  'network:disconnect',
  // Who did what, and when
  'audit:recent',
  // User accounts, for whenever they are switched back on
  'users:list',
  'users:save',
  'users:remove',
];
