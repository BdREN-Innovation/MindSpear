"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { ssoErrorMessage } from "../api";
import { redirectToSso } from "../session";
import { useSsoConfig } from "../useSsoConfig";

/** "Sign in with BDREN SSO". Renders nothing unless the backend has SSO enabled. */
export default function SsoSigninButton({ text }: { text: string }) {
	const config = useSsoConfig();
	const [loading, setLoading] = useState(false);

	if (!config?.enabled) return null;

	const start = async () => {
		setLoading(true);
		try {
			await redirectToSso("login");
		} catch (error) {
			toast.error(ssoErrorMessage(error, "Could not start BDREN sign-in."));
			setLoading(false);
		}
	};

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
