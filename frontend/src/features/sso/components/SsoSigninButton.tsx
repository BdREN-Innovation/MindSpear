"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { ssoErrorMessage } from "../api";
import { redirectToSso } from "../session";
import { useSsoConfig } from "../useSsoConfig";

/** `?sso=start` on the page: begin BDREN sign-in right away (BDREN's sign-up page sends people here). */
function takeAutoStart(): boolean {
	const url = new URL(window.location.href);
	if (url.searchParams.get("sso") !== "start") return false;
	// Drop it first, so coming back with the Back button doesn't start again.
	url.searchParams.delete("sso");
	window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
	return true;
}

/** "Sign in with BDREN SSO". Renders nothing unless the backend has SSO enabled. */
export default function SsoSigninButton({ text, autoStart = false }: { text: string; autoStart?: boolean }) {
	const config = useSsoConfig();
	const [loading, setLoading] = useState(false);
	const autoStarted = useRef(false);

	const start = async () => {
		setLoading(true);
		try {
			await redirectToSso("login");
		} catch (error) {
			toast.error(ssoErrorMessage(error, "Could not start BDREN sign-in."));
			setLoading(false);
		}
	};

	useEffect(() => {
		if (!autoStart || !config?.enabled || autoStarted.current) return;
		autoStarted.current = true;
		if (takeAutoStart()) void start();
	}, [autoStart, config?.enabled]);

	if (!config?.enabled) return null;

	return (
		<button
			type="button"
			onClick={start}
			disabled={loading}
			className="my-2 flex w-full items-center justify-center gap-3.5 rounded-lg border border-stroke bg-gray-2 p-[15px] font-medium hover:bg-opacity-50 disabled:opacity-70 dark:border-dark-3 dark:bg-dark-2 dark:hover:bg-opacity-50"
		>
			{loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <KeyRound className="h-5 w-5 text-secondary" aria-hidden />}
			{text} with {config.provider_name}
		</button>
	);
}
