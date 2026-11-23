import Signup from "@/features/auth/components/Auth/Signup";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Create account",
};

export default function SingUp() {
	return (
		<div className="min-h-screen flex lg:items-center justify-center bg-gray-100 dark:bg-gray-900 my-4">
			<div className="flex flex-col  md:w-[50%] w-full max-w-6xl bg-white dark:bg-gray-800  rounded-lg overflow-hidden">
				<div className="w-full p-8">
					<Signup />
				</div>
			</div>
		</div>
	);
}
