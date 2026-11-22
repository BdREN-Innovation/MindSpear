"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { loginWithMicrosoft } from "@/features/auth/store/authSlice";
import type { AppDispatch, RootState } from "@/stores/store";
import { toast } from "react-toastify";

export default function MicrosoftCallbackPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const dispatch = useDispatch<AppDispatch>();

	const { loading } = useSelector((state: RootState) => state.auth);

	useEffect(() => {
		const handleMicrosoftLogin = async () => {
			const code = searchParams.get("code");
			const state = searchParams.get("state");

			if (!code || !state) {
				console.error("Code or state missing in callback URL");
				router.push("/auth/sign-in?error=missing_code_or_state");
				return;
			}

			try {
				//console.log("Dispatching loginWithMicrosoft with code:", code, "and state:", state);
				await dispatch(loginWithMicrosoft({ code, state })).unwrap();
				//console.log("Microsoft login success, redirecting to dashboard");
				router.push("/dashboard");
			} catch (err) {
				console.error(" Microsoft login failed:", err);
				// The backend's reason, e.g. that new accounts come from BDREN (LOCAL_SIGNUP_ENABLED=false).
				toast.error(typeof err === "string" && err ? err : "Microsoft sign-in failed.");
				router.push("/auth/sign-in?error=microsoft_login_failed");
			}
		};

		handleMicrosoftLogin();
	}, [dispatch, searchParams, router]);

	return (
		<div className="flex min-h-screen items-center justify-center">
			{loading ? (
				<p>Signing you in with Microsoft...</p>
			) : (
				<p>Redirecting...</p>
			)}
		</div>
	);
}
