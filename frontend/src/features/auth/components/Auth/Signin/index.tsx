'use client'
import Link from "next/link";

import GoogleSigninButton from "../GoogleSigninButton";
import SigninWithPassword from "../SigninWithPassword";
import MicrosoftSigninButton from "../MicrosoftSigninButton";
import SsoSigninButton from "@/features/sso/components/SsoSigninButton";

export default function Signin() {
	return (
		<>
			<GoogleSigninButton text="Sign in" />
			<MicrosoftSigninButton text="Sign in" />
			<SsoSigninButton text="Sign in" autoStart />
			<div className="my-6 flex items-center justify-center">
				<span className="block h-px w-full bg-stroke dark:bg-dark-3"></span>
				<div className="block w-full min-w-fit bg-white px-3 text-center font-medium dark:bg-gray-dark">
					or Sign In with Email
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
						Sign Up
					</Link>
				</p>
			</div>
		</>
	);
}
