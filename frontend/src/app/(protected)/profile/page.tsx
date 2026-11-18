/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { toast } from "react-toastify";
import { api } from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import "react-toastify/dist/ReactToastify.css";
import { useDispatch } from "react-redux";
import { updateProfilePicture } from "@/features/auth/store/authSlice";
import SsoAccountPanel from "@/features/sso/components/SsoAccountPanel";
import type { AppDispatch } from "@/stores/store";
import { FiUser, FiMail, FiPhone, FiBriefcase, FiMapPin, FiCamera } from "react-icons/fi";
import ProfileSkeleton from "@/components/loading/ProfileSkeleton";

interface Profile {
	id: number;
	first_name: string;
	last_name: string;
	email: string;
	phone: string;
	email_verified_at: string | null;
	is_verified: boolean;
	profile_picture: string | null;
	account_type: string;
	institution_name: string;
	designation: string;
	department: string;
	full_name: string;
}

const ProfilePage = () => {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploadPreview, setUploadPreview] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [isEditing, setIsEditing] = useState(false);
	const dispatch = useDispatch<AppDispatch>();

	// Fetch profile data
	const fetchProfile = useCallback(async () => {
		try {
			setLoading(true);
			const res = await api.get<{ profile: Profile }>("/profile/show");
			setProfile(res.data.profile);
			setErrors({});
		} catch (err) {
			console.error("Failed to load profile", err);
			toast.error("Failed to load profile. Please try again later.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchProfile();
	}, [fetchProfile]);

	// Handle input changes
	const handleChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
	) => {
		const { name, value } = e.target;
		setProfile((prev) => (prev ? { ...prev, [name]: value } : null));

		// Clear error when user starts typing
		if (errors[name]) {
			setErrors(prev => {
				const newErrors = { ...prev };
				delete newErrors[name];
				return newErrors;
			});
		}
	};

	// Validate form
	const validateForm = (): boolean => {
		if (!profile) return false;

		const newErrors: Record<string, string> = {};

		if (!profile.first_name.trim()) {
			newErrors.first_name = "First name is required";
		}

		if (!profile.last_name.trim()) {
			newErrors.last_name = "Last name is required";
		}

		if (!profile.email.trim()) {
			newErrors.email = "Email is required";
		} else if (!/\S+@\S+\.\S+/.test(profile.email)) {
			newErrors.email = "Email is invalid";
		}

		if (!profile.phone.trim()) {
			newErrors.phone = "Phone is required";
		} else if (!/^\d{10,15}$/.test(profile.phone.replace(/\D/g, ''))) {
			newErrors.phone = "Phone number is invalid";
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	// API functions
	const updateProfile = async (data: Partial<Profile>) => {
		return await api.put<{ profile: Profile }>("/profile/update", data);
	};

	// Handle save
	const handleSave = async () => {
		if (!profile || !validateForm()) return;

		try {
			setSaving(true);

			// Upload image if selected using Redux thunk
			if (selectedFile) {
				const result = await dispatch(updateProfilePicture({ profilePicture: selectedFile }));
				if (updateProfilePicture.fulfilled.match(result)) {
					const newProfilePicture = result.payload.profile_picture;
					setProfile((prev) =>
						prev
							? {
								...prev,
								profile_picture: newProfilePicture,
							}
							: null
					);
					toast.success("Profile picture updated successfully!");
				} else {
					// Handle error from thunk
					const error = result.payload as string;
					toast.error(error || "Failed to update profile picture");
					return; // Exit early if image upload fails
				}
			}

			const updateData = {
				...profile,
				id: undefined,
				full_name: undefined,
				is_verified: undefined,
				email_verified_at: undefined,
				account_type: undefined,
				profile_picture: undefined,
			} as Partial<Profile>;

			// Remove undefined values
			Object.keys(updateData).forEach(key => {
				if (updateData[key as keyof Partial<Profile>] === undefined) {
					delete updateData[key as keyof Partial<Profile>];
				}
			});

			await updateProfile(updateData);
			toast.success("Profile updated successfully!");
			setIsEditing(false);
		} catch (error: unknown) {
			const err = error as AxiosError<any>;
			const validationErrors = err.response?.data?.data?.validation_errors || err.response?.data?.validation_errors;

			if (validationErrors && typeof validationErrors === "object") {
				const newErrors: Record<string, string> = {};
				Object.entries(validationErrors).forEach(([key, value]) => {
					newErrors[key] = Array.isArray(value) ? value[0] : String(value);
				});
				setErrors(newErrors);
				toast.error("Please fix the validation errors");
			} else {
				toast.error(
					(err.response?.data as any)?.message || (err.response?.data as any)?.data?.message || "Failed to update profile."
				);
			}
		} finally {
			setSaving(false);
		}
	};

	// Handle image selection
	const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			const file = e.target.files[0];

			// Validate file type
			if (!file.type.match('image.*')) {
				toast.error("Please select an image file");
				return;
			}

			// Validate file size (max 5MB)
			if (file.size > 5 * 1024 * 1024) {
				toast.error("File size should be less than 5MB");
				return;
			}

			setSelectedFile(file);
			setUploadPreview(URL.createObjectURL(file));
		}
	};

	// Cancel editing
	const handleCancel = () => {
		setIsEditing(false);
		fetchProfile(); // Reset to original values
		setSelectedFile(null);
		setUploadPreview(null);
	};

	// Reset image selection
	const handleResetImage = () => {
		setSelectedFile(null);
		setUploadPreview(null);
		// Reset file input
		const fileInput = document.getElementById('profile-image-input') as HTMLInputElement;
		if (fileInput) fileInput.value = '';
	};

	if (loading) return <ProfileSkeleton />;

	if (!profile) {
		return (
			<div className="w-full py-4 px-4">
				<div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow">
					<div className="text-center py-12">
						<p className="text-gray-500 dark:text-gray-400">No profile data found</p>
					</div>
				</div>
			</div>
		);
	}

	const editableFields: {
		label: string;
		name: keyof Profile;
		required?: boolean;
		icon?: React.ReactNode;
		type?: string;
	}[] = [
			{ label: "First Name", name: "first_name", required: true, icon: <FiUser className="text-gray-500" /> },
			{ label: "Last Name", name: "last_name", required: true, icon: <FiUser className="text-gray-500" /> },
			{ label: "Email", name: "email", required: true, icon: <FiMail className="text-gray-500" />, type: "email" },
			{ label: "Phone", name: "phone", required: true, icon: <FiPhone className="text-gray-500" />, type: "tel" },
			{ label: "Designation", name: "designation", icon: <FiBriefcase className="text-gray-500" /> },
			{ label: "Department", name: "department", icon: <FiBriefcase className="text-gray-500" /> },
			{ label: "Institution", name: "institution_name", icon: <FiMapPin className="text-gray-500" /> },
		];

	return (
		<div className="w-full mx-auto py-8 px-4">
			<div className="bg-white dark:bg-gray-900">
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
						Profile
					</h2>
					{!isEditing ? (
						<button
							onClick={() => setIsEditing(true)}
							className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors"
						>
							Edit Profile
						</button>
					) : null}
				</div>

				<div className="flex flex-col md:flex-row items-center md:items-start gap-8">
					{/* Profile picture section */}
					<div className="flex flex-col items-center">
						<div className="relative group">
							<div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-gray-200 dark:border-gray-700">
								<Image
									src={uploadPreview || profile.profile_picture || "/placeholder-avatar.jpg"}
									alt="Profile Picture"
									fill
									className="object-cover"
									sizes="(max-width: 768px) 128px, 128px"
								/>
							</div>

							{isEditing && (
								<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
									<label
										htmlFor="profile-image-input"
										className="cursor-pointer p-2 bg-white rounded-full shadow-md"
									>
										<FiCamera className="text-gray-700 w-5 h-5" />
									</label>
								</div>
							)}
						</div>

						{isEditing && (
							<div className="mt-3 flex gap-2">
								<input
									type="file"
									id="profile-image-input"
									accept="image/*"
									onChange={handleImageChange}
									className="hidden"
								/>
								{uploadPreview && (
									<button
										type="button"
										onClick={handleResetImage}
										className="text-xs text-red-500 hover:text-red-700"
									>
										Remove
									</button>
								)}
							</div>
						)}

						<div className="mt-4 text-center">
							<p className="text-sm text-gray-600 dark:text-gray-300">
								{profile.is_verified ? (
									<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
										Verified
									</span>
								) : (
									<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
										Not Verified
									</span>
								)}
							</p>
						</div>
					</div>

					{/* Profile form */}
					<div className="flex-1 w-full">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							{editableFields.map(({ label, name, required, icon, type = "text" }) => (
								<div key={name} className="space-y-1">
									<label className="flex text-sm font-medium text-gray-700 dark:text-gray-300 items-center">
										{icon && <span className="mr-2">{icon}</span>}
										{label}
										{required && <span className="text-red-500 ml-1">*</span>}
									</label>
									<input
										type={type}
										name={name}
										value={String(profile[name] || "")}
										onChange={handleChange}
										disabled={!isEditing}
										className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-colors ${isEditing
											? "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white focus:border-primary"
											: "bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 cursor-not-allowed"
											} ${errors[name] ? "border-red-500" : ""}`}
									/>
									{errors[name] && (
										<p className="text-red-500 text-xs mt-1">{errors[name]}</p>
									)}
								</div>
							))}
						</div>

						{/* Verification info */}
						<div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
							<h3 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Account Information</h3>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
								<div>
									<span className="text-gray-600 dark:text-gray-400">Email Verified:</span>
									<span className="ml-2 font-medium">
										{profile.email_verified_at ? "Yes" : "No"}
									</span>
								</div>
								<div>
									<span className="text-gray-600 dark:text-gray-400">Member Since:</span>
									<span className="ml-2 font-medium">
										{profile.email_verified_at
											? new Date(profile.email_verified_at).toLocaleDateString('en-US', {
												year: 'numeric',
												month: 'long',
												day: 'numeric'
											})
											: "Not verified"}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Action buttons */}
				{isEditing && (
					<div className="mt-8 flex justify-end space-x-3">
						<button
							onClick={handleCancel}
							disabled={saving}
							className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							onClick={handleSave}
							disabled={saving}
							className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center"
						>
							{saving ? (
								<>
									<svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
									</svg>
									Saving...
								</>
							) : "Save Changes"}
						</button>
					</div>
				)}
				<SsoAccountPanel />
			</div>
		</div>
	);
};

export default ProfilePage;