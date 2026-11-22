"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { loginWithGoogle } from "@/features/auth/store/authSlice";
import type { AppDispatch, RootState } from "@/stores/store";
import { toast } from "react-toastify";

export default function GoogleCallbackPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const dispatch = useDispatch<AppDispatch>();

	const { loading } = useSelector((state: RootState) => state.auth);

	useEffect(() => {
		const handleGoogleLogin = async () => {
			const code = searchParams.get("code");
			const scope = searchParams.get("scope");

			if (!code) {
				console.error("No code found in callback URL");
				router.push("/auth/sign-in?error=missing_code");
				return;
			}

			try {
				//console.log("Dispatching loginWithGoogle with code:", code);
				await dispatch(
					loginWithGoogle({ code, scope: scope || "" })
				).unwrap();
				//console.log("Google login success, redirecting to dashboard");
				router.push("/dashboard");
			} catch (err) {
				console.error("Google login failed:", err);
				// The backend's reason, e.g. that new accounts come from BDREN (LOCAL_SIGNUP_ENABLED=false).
				toast.error(typeof err === "string" && err ? err : "Google sign-in failed.");
				router.push("/auth/sign-in?error=google_login_failed");
			}
		};

		handleGoogleLogin();
	}, [dispatch, searchParams, router]);

	return (
		<div className="flex min-h-screen items-center justify-center">
			{loading ? (
				<p>Signing you in with Google...</p>
			) : (
				<p>Redirecting...</p>
			)}
		</div>
	);
}
