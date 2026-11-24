'use client'

import GoogleSigninButton from "../GoogleSigninButton";
import SigninWithPassword from "../SigninWithPassword";
import MicrosoftSigninButton from "../MicrosoftSigninButton";
import SsoSigninButton from "@/features/sso/components/SsoSigninButton";
import { useSsoConfig } from "@/features/sso/useSsoConfig";
import { useSilentSignIn } from "@/features/sso/useSilentSignIn";
import { Loader2 } from "lucide-react";

export default function Signin() {
	const config = useSsoConfig();
	// Only logins that can work: a button without server credentials can only fail.
	const google = config?.social?.google ?? false;
	const microsoft = config?.social?.microsoft ?? false;
	// Signed in to BDREN already: straight in. Not with ?sso=start, which asks for the full BDREN page.
	const explicit = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sso") === "start";
	const checking = useSilentSignIn({ active: !explicit, next: "/dashboard", fallback: "/auth/sign-in" });

	if (checking) {
		return (
			<p role="status" className="flex items-center justify-center gap-3 py-10 text-[15px] text-dark-4 dark:text-dark-6">
				<Loader2 className="h-5 w-5 animate-spin" aria-hidden />
				Checking your BdREN sign-in…
			</p>
		);
	}

	return (
		<>
			{/* BDREN is the main way in; it renders nothing while SSO is off. */}
			<SsoSigninButton text="Sign in" autoStart primary />
			{/* {google && <GoogleSigninButton text="Sign in" />}
			{microsoft && <MicrosoftSigninButton text="Sign in" />}
			<div className="my-6 flex items-center justify-center">
				<span className="block h-px w-full bg-stroke dark:bg-dark-3"></span>
				<div className="block w-full min-w-fit bg-white px-3 text-center font-medium dark:bg-gray-dark">
					or sign in with email and password
				</div>
				<span className="block h-px w-full bg-stroke dark:bg-dark-3"></span>
			</div> */}

			{/* <div>
				<SigninWithPassword />
			</div> */}

			{/* <div className="mt-6 text-center">
				<p>
					{`Don't have an account?`} &nbsp;
					<Link
						href="/auth/sign-up"
						className="text-primary hover:underline"
					>
						Sign up
					</Link>
				</p>
			</div> */}
			{/* Accounts are created on bdren.ai only; it brings the person back here signed in. */}
			{config?.signup_url && (
				<div className="mt-6 text-center">
					<p>
						New to Mindspear?&nbsp;
						<a href={config.signup_url} className="text-primary hover:underline">
							Create a BdREN account
						</a>
					</p>
				</div>
			)}
		</>
	);
}
