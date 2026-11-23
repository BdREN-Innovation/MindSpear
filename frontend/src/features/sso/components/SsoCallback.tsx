"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch } from "react-redux";
import { Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { setCredentials } from "@/features/auth/store/authSlice";
import type { AppDispatch } from "@/stores/store";
import { ssoApi, ssoErrorMessage } from "../api";
import {
	clearSignInNotes,
	markSignedInWithSso,
	noteNotSignedIn,
	takeFallback,
	takeNext,
	takeSilentAttempt,
	takeSsoState,
} from "../session";

/**
 * Where ZITADEL sends the browser back (SSO_REDIRECT_URI). Hands code + state to
 * the backend, which checks everything; then stores Mindspear's token exactly
 * like the password and Google logins do.
 */
export default function SsoCallback() {
	const router = useRouter();
	const params = useSearchParams();
	const dispatch = useDispatch<AppDispatch>();
	const [error, setError] = useState<string | null>(null);
	// The state is single use: run once, also under React's development double effects.
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;

		const code = params.get("code");
		const state = params.get("state");
		const providerError = params.get("error_description") || params.get("error");

		// A silent check (prompt=none) that BDREN answered with an error (normally login_required: nobody is
		// signed in) is not a failure: back to the page that asked, which shows its own sign-in button.
		if (takeSilentAttempt() && providerError) {
			takeSsoState(state ?? "");
			takeNext();
			noteNotSignedIn();
			router.replace(takeFallback());
			return;
		}

		if (providerError) {
			setError(`BDREN sign-in was not completed: ${providerError}`);
			return;
		}
		if (!code || !state) {
			setError("This page needs the sign-in response from BDREN. Please start again.");
			return;
		}
		if (!takeSsoState(state)) {
			setError("This sign-in was started in another browser or tab. Please start again here.");
			return;
		}

		(async () => {
			try {
				const result = await ssoApi.callback(code, state);
				if (result.mode === "link") {
					toast.success("Your BDREN account is connected.");
					router.replace("/profile");
					return;
				}

				localStorage.setItem("auth_token", result.token);
				// For server-side API calls (utils/serverApiService.ts), as the other logins do.
				await fetch("/api/auth/set-cookie", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ token: result.token }),
				});
				markSignedInWithSso();
				clearSignInNotes();
				dispatch(
					setCredentials({
						token: result.token,
						user: {
							id: result.user.id,
							full_name: `${result.user.first_name || ""} ${result.user.last_name || ""}`.trim(),
							email: result.user.email,
							profile_picture: result.user.profile_picture ?? null,
						},
					}),
				);
				router.replace(takeNext() ?? "/dashboard");
			} catch (err) {
				setError(ssoErrorMessage(err, "BDREN sign-in failed. Please try again."));
			}
		})();
	}, [dispatch, params, router]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-gray-900">
			<div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-sm dark:bg-gray-800">
				{error ? (
					<>
						<h1 className="mb-2 text-lg font-semibold text-dark dark:text-white">Sign-in didn&apos;t finish</h1>
						<p role="alert" className="mb-6 text-sm text-dark-5 dark:text-dark-6">
							{error}
						</p>
						<Link href="/auth/sign-in" className="inline-flex rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-opacity-90">
							Back to sign in
						</Link>
					</>
				) : (
					<p className="flex items-center justify-center gap-3 text-dark dark:text-white" role="status">
						<Loader2 className="h-5 w-5 animate-spin" aria-hidden />
						Signing you in with BDREN…
					</p>
				)}
			</div>
		</div>
	);
}
