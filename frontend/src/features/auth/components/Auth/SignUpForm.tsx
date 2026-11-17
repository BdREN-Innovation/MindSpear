"use client";

import { EmailIcon, PasswordIcon, EyeIcon, EyeSlashIcon } from "@/assets/icons";
import React, { useState, useEffect } from "react";
import InputGroup from "@/components/FormElements/InputGroup";
import { CiUser } from "react-icons/ci";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDispatch, useSelector } from "react-redux";
import { registerUser, clearError } from "@/features/auth/store/authSlice";
import type { RootState, AppDispatch } from "@/stores/store";
import Image from "next/image";
import Link from "next/link";
import ResendVerificationEmail from "./ResendVerificationEmail";

const formSchema = z
	.object({
		first_name: z.string().min(1, "First name is required"),
		last_name: z.string().min(1, "Last name is required"),
		email: z.string().email("Enter a valid email"),
		password: z.string().min(8, "Password must be at least 8 characters"),
		password_confirmation: z.string(),
	})
	.refine((data) => data.password === data.password_confirmation, {
		path: ["password_confirmation"],
		message: "Passwords do not match",
	});

type FormData = z.infer<typeof formSchema>;

export default function SignUpForm() {
	const dispatch = useDispatch<AppDispatch>();
	const { loading: registerLoading, error: registerError } = useSelector((state: RootState) => state.auth);
	const [apiMassage, setMassage] = useState<string | null>(null);
	const [isVerify, setIsVerify] = useState(false);
	const [emailFailed, setEmailFailed] = useState(false);
	const [registeredEmail, setRegisteredEmail] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
		reset,
	} = useForm<FormData>({
		resolver: zodResolver(formSchema),
	});

	// Clear error on component mount
	useEffect(() => {
		dispatch(clearError());
	}, [dispatch]);

	const onSubmit = async (data: FormData) => {
		const result = await dispatch(registerUser(data));

		if (registerUser.fulfilled.match(result)) {
			const failed = result.payload.emailSent === false;
			setEmailFailed(failed);
			setMassage(
				failed
					? "Your account was created, but we could not send the verification email. Please try again below."
					: "Registration successful! Please check your email."
			);
			setRegisteredEmail(data.email);
			setIsVerify(true);
			// Reset form after successful registration
			reset();
		}
	};

	return (
		<>
			<div className="flex flex-col  justify-center items-center">
				<Link href="/">
					<Image
						src="/images/logo/logo.svg"
						alt="Logo"
						width={176}
						height={32}
						className=""
					/>
				</Link>
				<h1 className="text-3xl font-bold mb-2 text-[#222]">
					{" "}
					{isVerify
						? emailFailed
							? "We couldn't send your email"
							: " Check your email!"
						: ""}
				</h1>
				<p className="text-lg mb-4 text-center max-w-md text-[#222]">
					{isVerify
						? apiMassage
						: "Please sign in to your account by completing the necessary fields below."}
				</p>
			</div>

			{isVerify ? (
				<ResendVerificationEmail
					email={registeredEmail}
					onSent={() => {
						setEmailFailed(false);
						setMassage("Your verification link is on its way.");
					}}
				/>
			) : (
				<form onSubmit={handleSubmit(onSubmit)}>
					<div className="grid grid-cols-2 gap-4">
						<InputGroup
							type="text"
							label="First Name"
							className="mb-4 [&_input]:py-[15px]"
							placeholder="Enter your first name"
							{...register("first_name")}
							error={errors.first_name?.message}
							icon={<CiUser className="text-[25px]" />}
							required
						/>
						<InputGroup
							type="text"
							label="Last Name"
							className="mb-4 [&_input]:py-[15px]"
							placeholder="Enter your last name"
							{...register("last_name")}
							error={errors.last_name?.message}
							icon={<CiUser className="text-[25px]" />}
							required
						/>
					</div>

					<InputGroup
						type="email"
						label="Email"
						className="mb-4 [&_input]:py-[15px]"
						placeholder="Enter your email"
						{...register("email")}
						error={errors.email?.message}
						icon={<EmailIcon />}
						required
					/>

					<div className="grid grid-cols-2 gap-4">
						<InputGroup
							type={showPassword ? "text" : "password"}
							label="Password"
							className="mb-5 [&_input]:py-[15px]"
							placeholder="Enter your password"
							{...register("password")}
							error={errors.password?.message}
							icon={<PasswordIcon />}
							suffixIcon={showPassword ? <EyeSlashIcon className="text-[20px]" /> : <EyeIcon className="text-[20px]" />}
							suffixIconClick={() => setShowPassword(!showPassword)}
							required
						/>
						<InputGroup
							type={showPasswordConfirm ? "text" : "password"}
							label="Password Confirmation"
							className="mb-5 [&_input]:py-[15px]"
							placeholder="Confirm your password"
							{...register("password_confirmation")}
							error={errors.password_confirmation?.message}
							icon={<PasswordIcon />}
							suffixIcon={showPasswordConfirm ? <EyeSlashIcon className="text-[20px]" /> : <EyeIcon className="text-[20px]" />}
							suffixIconClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
							required
						/>
					</div>

					{registerError && (
						<p className="text-red-500 mb-4">{registerError}</p>
					)}

					<div className="mb-4.5">
						<button
							type="submit"
							disabled={registerLoading}
							className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary p-4 font-medium text-white transition hover:bg-opacity-90 disabled:opacity-60"
						>
							Sign Up
							{registerLoading && (
								<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-t-transparent" />
							)}
						</button>
					</div>
				</form>
			)}

			{isVerify ? (
				""
			) : (
				<div className="mt-6 text-center">
					<p>
						{`Already have an account?`} &nbsp;
						<Link
							href="/auth/sign-in"
							className="text-primary hover:underline"
						>
							Sign In
						</Link>
					</p>
				</div>
			)}
		</>
	);
}
