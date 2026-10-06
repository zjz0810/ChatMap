import type { Turn } from "../shared/types.ts";
import { mergeChatGptWindows } from "../shared/chatgpt-turn-order.ts";

type ScanOptions = {
  scroller: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight" | "scrollTo">;
  range: () => { min: number; max: number };
  read: () => Turn[];
  pause: () => Promise<void>;
  isCurrent: () => boolean;
  maxSteps?: number;
};

export async function scanChatGptHistory({ scroller, range, read, pause, isCurrent, maxSteps = 160 }: ScanOptions) {
  const originalTop = scroller.scrollTop;
  let turns: Turn[] = [];
  let steps = 0;
  let topStable = 0;
  let bottomStable = 0;
  const checkCurrent = () => {
    if (!isCurrent()) throw new Error("Conversation changed during history scan.");
  };
  try {
    // History prepending can change both the height and scrollTop. Wait for a stable top.
    for (let attempt = 0; attempt < 16 && topStable < 2; attempt += 1) {
      checkCurrent();
      const height = scroller.scrollHeight;
      scroller.scrollTo({ top: range().min, behavior: "instant" });
      await pause();
      topStable = Math.abs(scroller.scrollTop - range().min) <= 1 && height === scroller.scrollHeight
        ? topStable + 1 : 0;
    }
    for (; steps < maxSteps; steps += 1) {
      checkCurrent();
      turns = mergeChatGptWindows(turns, read(), true);
      const { max } = range();
      const height = scroller.scrollHeight;
      const atBottom = scroller.scrollTop >= max - 1;
      if (!atBottom) {
        bottomStable = 0;
        scroller.scrollTo({ top: Math.min(max, scroller.scrollTop + Math.max(120, scroller.clientHeight * 0.65)), behavior: "instant" });
      }
      await pause();
      if (atBottom && height === scroller.scrollHeight && scroller.scrollTop >= range().max - 1) {
        bottomStable += 1;
        if (bottomStable >= 2) {
          turns = mergeChatGptWindows(turns, read(), true);
          break;
        }
      }
    }
    checkCurrent();
    return { turns, steps: steps + 1, complete: topStable >= 2 && bottomStable >= 2 };
  } finally {
    if (isCurrent()) scroller.scrollTo({ top: originalTop, behavior: "instant" });
  }
}
