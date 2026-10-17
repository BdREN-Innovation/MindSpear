// Direction of the next screen change (plan §4.3: forward slides in from the
// right, back from the left). Screens call markNavigation() right before
// router.push / replace; the next AppShell to mount reads it. A short expiry
// keeps a stale mark from animating an unrelated later mount. Browser back
// can't be told apart from forward (popstate has no direction), so it fades.

export type NavDirection = 1 | -1 | 0;

const FRESH_MS = 1500;
let mark: { direction: NavDirection; at: number } | null = null;

export function markNavigation(direction: NavDirection): void {
	mark = { direction, at: Date.now() };
}

/** The direction of a navigation marked in the last moment, else 0. */
export function recentNavigation(): NavDirection {
	if (!mark || Date.now() - mark.at > FRESH_MS) return 0;
	return mark.direction;
}
