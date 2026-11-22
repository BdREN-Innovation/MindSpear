"use client";

import { Loader2 } from "lucide-react";
import BdrenSignup from "@/features/sso/components/BdrenSignup";
import { useSsoConfig } from "@/features/sso/useSsoConfig";
import SignUpForm from "../SignUpForm";

export default function Signup() {
	const config = useSsoConfig();

	if (config === undefined) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-label="Loading" />
			</div>
		);
	}

	// Config unreadable (null): show the form; the backend still refuses it when sign-up is off.
	if (config && !config.local_signup) return <BdrenSignup signupUrl={config.signup_url} />;

	return <SignUpForm />;
}
