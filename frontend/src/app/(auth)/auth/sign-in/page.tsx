'use client'
import Signin from "@/features/auth/components/Auth/Signin";
import Image from "next/image";
import Link from "next/link";


export default function SignIn() {
	return (
		<div className="min-h-screen flex lg:items-center justify-center bg-gray-100 dark:bg-gray-900">
			<div className="flex flex-col w-full max-w-md bg-white dark:bg-gray-800  rounded-lg overflow-hidden my-4">
				<div className="w-full px-8 py-4 text-white flex-col justify-center items-center">
					<Link href="/" className="flex items-center justify-center">
						<Image
							src="/images/logo/logo.svg"
							alt="Logo"
							width={176}
							height={32}
							className="mb-3"
						/>
					</Link>
					<p className="text-lg text-center max-w-md text-[#222]">
						Please sign in to your account 
						{/* by completing the necessary fields below. */}
					</p>
				</div>
				<div className="w-full  px-8 py-4">
					<Signin />
				</div>
			</div>
		</div>
	);
}
