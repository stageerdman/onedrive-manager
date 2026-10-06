/**
 * Next.js startup hook (runs once when the server process boots).
 *
 * We use it for one thing: pick up any cross-account move that was still in flight when
 * the process last stopped and continue it automatically. See
 * `resumeInterruptedMoves()` in `lib/graph/move.ts`. This is what lets a move finish on
 * an always-on host without the owner clicking Resume — even if the host restarted
 * mid-move.
 */
export async function register() {
  // register() also runs in the edge runtime; the move engine (SQLite, Node APIs) is
  // nodejs-only, so load it only there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeInterruptedMoves } = await import("@/lib/graph/move");
  resumeInterruptedMoves();
}
