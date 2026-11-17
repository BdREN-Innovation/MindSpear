"use client";

import { useEffect, useState } from "react";

// On iOS and on Android Chrome ≥ 108 the software keyboard shrinks only the
// *visual* viewport: a fixed full-screen frame keeps its height and the
// keyboard covers its bottom. visualViewport tells us how much is covered.
// Where visualViewport is missing the inset stays 0 (graceful no-op).

/** Ignore small differences (collapsing URL bars); only real keyboards count. */
const MIN_KEYBOARD_PX = 80;

/** Height (px) of the area the on-screen keyboard covers, 0 when closed or unknown. */
export function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);

	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
				setInset(covered >= MIN_KEYBOARD_PX ? covered : 0);
			});
		};
		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		return () => {
			cancelAnimationFrame(frame);
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
		};
	}, []);

	return inset;
}
