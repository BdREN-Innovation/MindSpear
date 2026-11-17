"use client";
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ChevronUpIcon } from "@/assets/icons";
import {
	Dropdown,
	DropdownContent,
	DropdownTrigger,
} from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOutIcon, SettingsIcon, UserIcon } from "./icons";
import type { AppDispatch } from "@/stores/store";
import { persistor } from "@/stores/store";
import { useDispatch } from "react-redux";
import { useRouter } from "next/navigation";
import { clearAuth, logoutUser } from "@/features/auth/store/authSlice";
import { useSelector } from "react-redux";
import type { RootState } from "@/stores/store";
import { BadgePercent } from "lucide-react";
import { api } from "@/utils/axiosInstance";
import { toast } from "react-toastify";

interface UserInfoState {
	id: number;
	full_name: string;
	email: string;
	profile_picture?: string | null;
}

export function UserInfo() {
	const [isOpen, setIsOpen] = useState(false);
	const [imgError, setImgError] = useState(false);
	const [showModal, setShowModal] = useState(false);

	const dispatch = useDispatch<AppDispatch>();
	const user = useSelector((state: RootState) => state.auth.user);

	const profileImage = user?.profile_picture;

	const router = useRouter();

	useEffect(() => {
		setImgError(false);
	}, [user?.profile_picture]);

	useEffect(() => {
		if (!user) {
			setShowModal(true);
		}
	}, [user]);

	const firstName = user?.full_name?.split(" ")?.[0] || "User";
	const initials = user?.full_name
		?.split(" ")
		.map((n) => n[0])
		.join("")
		.slice(0, 1)
		.toUpperCase();
	// console.log('Initials and user:', initials, user);

	const handleLogout = async () => {
		dispatch(logoutUser());
		dispatch(clearAuth());
		persistor.purge();
		localStorage.removeItem("persist:root");
		router.push("/");
	};

	return (
		<>
			{showModal && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[9999]">
					<div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-[300px] shadow-xl text-center">
						<h2 className="text-lg font-semibold mb-4 text-dark dark:text-white">
							Session expired
						</h2>
						<p className="text-gray-600 dark:text-gray-300 mb-6">
							Please log in again.
						</p>

						<button
							onClick={handleLogout}
							className="w-full py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
						>
							Log out
						</button>
					</div>
				</div>
			)}

			<Dropdown isOpen={isOpen} setIsOpen={setIsOpen}>
				<DropdownTrigger className="rounded align-middle outline-none ring-primary ring-offset-2 focus-visible:ring-1 dark:ring-offset-gray-dark">
					<span className="sr-only">My Account</span>

					<figure className="flex items-center gap-3">
						{profileImage ? (
							<Image
								src={`${profileImage}?v=${Date.now()}`}
								className="size-9 rounded-full border-2 border-primary object-cover"
								alt={`Avatar of ${firstName}`}
								width={48}
								height={48}
							/>
						) : (
							<div className="size-9 rounded-full bg-primary text-white flex items-center justify-center text-md font-semibold uppercase">
								{initials}
							</div>
						)}
						<figcaption className="flex items-center gap-1 font-medium text-dark dark:text-dark-6 max-[1024px]:sr-only">
							<span>{firstName}</span>

							<ChevronUpIcon
								aria-hidden
								className={cn(
									"rotate-180 transition-transform",
									isOpen && "rotate-0"
								)}
								strokeWidth={1.5}
							/>
						</figcaption>
					</figure>
				</DropdownTrigger>

				<DropdownContent
					className="border border-stroke bg-white shadow-md dark:border-dark-3 dark:bg-gray-dark min-[230px]:min-w-[17.5rem]"
					align="end"
				>
					<h2 className="sr-only">User information</h2>

					<figure className="flex items-center gap-2.5 px-5 py-3.5">
						{profileImage ? (
							<Image
								src={profileImage}
								className="w-12 h-12 rounded-full object-cover"
								alt={`Avatar of ${firstName}`}
								width={48}
								height={48}
								onError={() => setImgError(true)}
							/>
						) : (
							<div className="size-12 rounded-full bg-primary text-white flex items-center justify-center text-sm font-semibold uppercase">
								{initials}
							</div>
						)}

						<figcaption className="space-y-1 text-base font-medium overflow-hidden">
							<div className="mb-2 leading-none text-dark dark:text-white">
								{firstName}
							</div>

							<p className="leading-none text-gray-6 truncate overflow-hidden">
								{user?.email}
							</p>
						</figcaption>
					</figure>

					<hr className="border-[#E8E8E8] dark:border-dark-3" />

					<div className="p-2 text-base text-[#4B5563] dark:text-dark-6 [&>*]:cursor-pointer">
						<Link
							href={"/profile"}
							onClick={() => setIsOpen(false)}
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
						>
							<UserIcon />

							<span className="mr-auto text-base font-medium">
								My profile
							</span>
						</Link>
						{/* <Link
							href={"/plans"}
							onClick={() => setIsOpen(false)}
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
						>
							<BadgePercent size={19} />

							<span className="mr-auto text-base font-medium">
								Plans
							</span>
						</Link> */}
						{/* <Link
							href={"/billing"}
							onClick={() => setIsOpen(false)}
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
						>
							<BadgePercent size={19} />

							<span className="mr-auto text-base font-medium">
								Billing
							</span>
						</Link> */}
						<Link
							href={"/settings"}
							onClick={() => setIsOpen(false)}
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
						>
							<SettingsIcon />

							<span className="mr-auto text-base font-medium">
								Account Settings
							</span>
						</Link>
					</div>

					<hr className="border-[#E8E8E8] dark:border-dark-3" />

					<div className="p-2 text-base text-[#4B5563] dark:text-dark-6">
						<button
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] hover:bg-gray-2 hover:text-dark dark:hover:bg-dark-3 dark:hover:text-white"
							onClick={() => {
								handleLogout();
								setIsOpen(false);
							}}
						>
							<LogOutIcon />

							<span className="text-base font-medium">
								Log out
							</span>
						</button>
					</div>
				</DropdownContent>
			</Dropdown>
		</>
	);
}
