import type { CSSProperties } from "react";

/**
 * The presenter shell draws its timer chip in the stage's top-right corner
 * (about 220 × 56 px). PresenterStage already pads 4cqw, so a header row
 * that reaches the right edge adds the rest to keep that area clear.
 */
export const TIMER_CHIP_CLEARANCE: CSSProperties = { paddingRight: "max(0px, calc(220px - 4cqw))" };
