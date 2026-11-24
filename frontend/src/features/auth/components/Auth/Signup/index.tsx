"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import BdrenSignup from "@/features/sso/components/BdrenSignup";
import { useSsoConfig } from "@/features/sso/useSsoConfig";
// import SignUpForm from "../SignUpForm";

/** Mindspear has no sign-up of its own: accounts are created on bdren.ai, which brings the person back signed in. */
export default function Signup() {
	const config = useSsoConfig();
	const signupUrl = config?.signup_url ?? null;

	useEffect(() => {
		if (signupUrl) window.location.replace(signupUrl);
	}, [signupUrl]);

	if (config === undefined || signupUrl) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-label="Taking you to BdREN sign-up" />
			</div>
		);
	}
	// // Config unreadable (null): show the form; the backend still refuses it when sign-up is off.
	// if (config && !config.local_signup) return <BdrenSignup signupUrl={config.signup_url} />;

	// return <SignUpForm />;
	// BDREN sign-up isn't configured or reachable: say so instead of offering a form.
	return <BdrenSignup signupUrl={null} />;
}
