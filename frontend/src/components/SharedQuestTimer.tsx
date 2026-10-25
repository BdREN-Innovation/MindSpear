/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/no-children-prop */
"use client";

import React, {
	useEffect,
	useMemo,
	useState,
	useCallback,
} from "react";
import { useSelector } from "react-redux";
import TimeShow from "./TimeShow";
import { secondsUntil } from "@/features/live/services/liveTimer";

type UserTimeSet = {
	questId?: string | number;
	questionId?: string | number;
	questiQsenStartTime?: string;
	questiQsenTime?: string | number;
	questiQsenLateStartTime?: string | boolean; 
	questiQsenDeadline?: number | null;
};

type SharedQuestTimerProps = {
	attemptId: string | number;
	lsKey?: string; 
	onTimeUpdate?: (remaining: number, elapsed: number, total: number) => void;
	onExpire?: () => void;
	persistKeyPrefix?: string; 
};

function readUserTimeSet(lsKey = "userTimeSet"): UserTimeSet | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(lsKey);
		if (!raw) return null;
		return JSON.parse(raw) as UserTimeSet;
	} catch {
		return null;
	}
}

const parsePrettyDate = (s?: string | false | null) => {
	if (!s || typeof s !== "string") return null;
	const norm = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
	const d = new Date(norm);
	return isNaN(d.getTime()) ? null : d;
};

const toIntSeconds = (v: unknown, fallback = 60): number => {
	const n =
		typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.max(0, Math.floor(n));
};


const readRemain = (k: string): number | null => {
	try {
		const raw = localStorage.getItem(k);
		if (!raw) return null;
		const j = JSON.parse(raw);
		const r = Number(j?.remaining);
		return Number.isFinite(r) ? Math.max(0, Math.floor(r)) : null;
	} catch {
		return null;
	}
};
const writeRemain = (k: string, remaining: number, total: number) => {
	try {
		localStorage.setItem(
			k,
			JSON.stringify({
				remaining: Math.max(0, Math.floor(remaining)),
				total: Math.max(0, Math.floor(total)),
				savedAt: Date.now(),
			})
		);
	} catch {}
};
const removeRemain = (k: string) => {
	try {
		localStorage.removeItem(k);
	} catch {}
};

export default function SharedQuestTimer({
	attemptId,
	lsKey = "userTimeSet",
	onTimeUpdate,
	onExpire,
}: SharedQuestTimerProps) {
	const reduxUserSet = useSelector(
		(state: any) => state.questTime,
	) as UserTimeSet | null;
	const [userSet, setUserSet] = useState<UserTimeSet | null>(null);
	const fallbackUserSet = useMemo(() => {
		if (!reduxUserSet?.questionId || !reduxUserSet?.questiQsenTime) {
			return null;
		}
		return reduxUserSet;
	}, [reduxUserSet]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		setUserSet(readUserTimeSet(lsKey) ?? fallbackUserSet);

		let lastRaw = localStorage.getItem(lsKey) ?? "__EMPTY__";

		const tick = () => {
			const raw = localStorage.getItem(lsKey) ?? "__EMPTY__";
			if (raw !== lastRaw) {
				lastRaw = raw;
				setUserSet(readUserTimeSet(lsKey) ?? fallbackUserSet);
			}
		};

		const id = setInterval(tick, 300);
		return () => clearInterval(id);
	}, [fallbackUserSet, lsKey]);

	// Every caller passes "attempt-<question id>". Effects run child-first, so a new question's
	// timer mounts while the stored timer still belongs to the previous one; counting that
	// one's (past) deadline ended the new question at once ("Time's up" on arrival).
	const forThisQuestion =
		String(userSet?.questionId ?? "") === String(attemptId).replace(/^attempt-/, "");
	const ready = Boolean(
		attemptId &&
			userSet?.questiQsenStartTime &&
			userSet?.questiQsenTime &&
			userSet?.questionId &&
			forThisQuestion
	);

	const intendedInitial = useMemo(() => {
		const intended = toIntSeconds(userSet?.questiQsenTime, 60);

		const lateRaw = userSet?.questiQsenLateStartTime as unknown;
		const lateIsFalse = lateRaw === false || lateRaw === "false";
		if (lateIsFalse) return intended;

		const startDate = parsePrettyDate(userSet?.questiQsenStartTime as any);
		const lateDate = parsePrettyDate(
			userSet?.questiQsenLateStartTime as any
		);
		if (startDate && lateDate) {
			const diffSeconds = Math.max(
				0,
				Math.floor(
					Math.abs(lateDate.getTime() - startDate.getTime()) / 1000
				)
			);
			return Math.max(0, intended - diffSeconds);
		}
		return intended;
	}, [
		userSet?.questiQsenTime,
		userSet?.questiQsenStartTime,
		userSet?.questiQsenLateStartTime,
	]);

  const normalizeAttemptId = (id: string | number) => {
  const s = String(id);
  return s.startsWith("attempt-") ? s.slice("attempt-".length) : s;
};

const normAttemptId = useMemo(() => normalizeAttemptId(attemptId), [attemptId]);

	const storageKey = useMemo(() => {
  if (!userSet?.questionId) return null;
  return `attempt-${normAttemptId}::${userSet.questionId}`;
}, [normAttemptId, userSet?.questionId]);

const familyPrefix = useMemo(() => {
  return `attempt-${normAttemptId}::`;
}, [normAttemptId]);

	useEffect(() => {
  if (!storageKey) return;
  try {
    const keys = Object.keys(localStorage);

    for (const k of keys) {
      if (k.startsWith(familyPrefix) && k !== storageKey) {
        localStorage.removeItem(k);
        continue;
      }
      if (k.startsWith(`attempt-attempt-`)) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}, [storageKey, familyPrefix]);


const timeLimit = useMemo(() => {
  if (!storageKey || !forThisQuestion) return 0;

  // A live question's time left comes from the server, so a reload or reconnect resumes it
  // exactly (the saved remainder below was stale by the reload, or a whole question old).
  const live = secondsUntil(userSet?.questiQsenDeadline);
  if (live !== null) return live;

  const cached = readRemain(storageKey);
  if (typeof cached === "number" && cached >= 0) {
    return cached;             
  }
  return intendedInitial;    
}, [storageKey, forThisQuestion, intendedInitial, userSet?.questionId, userSet?.questiQsenDeadline]);



	const timerData = useMemo(() => {
		if (!ready) return null;
		return {
			id: `${attemptId}::${userSet!.questionId}`,
			quiztime_mode: false, 
			time_limit: timeLimit, 
			duration: undefined, 
			open_datetime: userSet!.questiQsenStartTime,
			close_datetime: userSet!.questiQsenLateStartTime as any,
		};
	}, [
		ready,
		attemptId,
		userSet?.questionId,
		userSet?.questiQsenStartTime,
		userSet?.questiQsenLateStartTime,
		timeLimit,
	]);

	const handleTimeUpdate = useCallback(
		(remaining: number, elapsed: number, total: number) => {
			if (storageKey) writeRemain(storageKey, remaining, total);
			onTimeUpdate?.(remaining, elapsed, total);
		},
		[storageKey, onTimeUpdate]
	);

	const handleExpire = useCallback(() => {
		if (storageKey) removeRemain(storageKey);
		onExpire?.();
	}, [storageKey, onExpire]);

	// Arriving after the time ran out: a zero-length countdown never completes, which left the
	// question open (and answerable) at 00:00.
	const expiredOnArrival = Boolean(timerData) && timeLimit <= 0;
	useEffect(() => {
		if (expiredOnArrival) handleExpire();
	}, [expiredOnArrival]);

	if (!timerData) return null;

	return (
		<TimeShow
			key={`${attemptId}::${userSet?.questionId}`} 
			data={{
				id: `${attemptId}::${userSet?.questionId}`,
				quiztime_mode: false,
				time_limit: timeLimit,
				open_datetime: userSet?.questiQsenStartTime,
				close_datetime: userSet?.questiQsenLateStartTime as any,
			}}
			onTimeUpdate={handleTimeUpdate}
			onExpire={handleExpire}
			autoStart={true}
			tickIntervalSec={1}
		/>
	);
}
