'use client'
import Link from "next/link";

import GoogleSigninButton from "../GoogleSigninButton";
import SigninWithPassword from "../SigninWithPassword";
import MicrosoftSigninButton from "../MicrosoftSigninButton";
import SsoSigninButton from "@/features/sso/components/SsoSigninButton";
import { useSsoConfig } from "@/features/sso/useSsoConfig";

export default function Signin() {
	const config = useSsoConfig();
	// Only logins that can work: a button without server credentials can only fail.
	const google = config?.social?.google ?? false;
	const microsoft = config?.social?.microsoft ?? false;

	return (
		<>
			{/* BDREN is the main way in; it renders nothing while SSO is off. */}
			<SsoSigninButton text="Sign in" autoStart primary />
			{google && <GoogleSigninButton text="Sign in" />}
			{microsoft && <MicrosoftSigninButton text="Sign in" />}
			<div className="my-6 flex items-center justify-center">
				<span className="block h-px w-full bg-stroke dark:bg-dark-3"></span>
				<div className="block w-full min-w-fit bg-white px-3 text-center font-medium dark:bg-gray-dark">
					or sign in with email and password
				</div>
				<span className="block h-px w-full bg-stroke dark:bg-dark-3"></span>
			</div>

			<div>
				<SigninWithPassword />
			</div>

			<div className="mt-6 text-center">
				<p>
					{`Don't have an account?`} &nbsp;
					<Link
						href="/auth/sign-up"
						className="text-primary hover:underline"
					>
						Sign up
					</Link>
				</p>
			</div>
		</>
	);
}
