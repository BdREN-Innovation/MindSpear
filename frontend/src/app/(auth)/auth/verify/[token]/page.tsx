'use client';

import { EmailIcon } from "@/assets/icons";
import React, { useEffect, useState } from "react";
import InputGroup from "@/components/FormElements/InputGroup";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axiosInstance from "@/utils/axiosInstance";
import { useRouter, useParams, usePathname } from "next/navigation";
import { AxiosError } from "axios";
import { toast } from "react-toastify";
const formSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

type FormData = z.infer<typeof formSchema>;
export default function VerifyForm() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  

  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });
  const rawTokenString = params?.token as string;

  const pathname = usePathname();

  useEffect(() => {
    const verifyTokenOnly = async () => {

      const rawSegment = pathname.split('/verify/')[1];
      const urlParts = new URLSearchParams(rawSegment.replace(/&/g, '&'));
    
      const token = urlParts.get('token') || '';
      const email = (urlParts.get('email') || '').replace('%40', '@');

      if (!token || !email) return;

      try {
        setIsSubmitting(true);
        const response = await axiosInstance.post('/verify-email', {
          email,
          token,
        });
        if (response.status === 200) {
          setInitialCheckDone(true);
          // The link proves the address only; signing in still needs the password or BDREN.
          toast.success(response?.data?.message || 'Email verified. You can sign in now.');
          router.replace('/auth/sign-in');
        } else {
          toast.error("Verification failed. Please try again.");
          
        }
      } catch (error) {
        const axiosError = error as AxiosError<{ message?: string }>;

        if (axiosError.response) {
          toast.error(`Error: ${axiosError.response.data?.message || 'Verification failed.'}`);
        } else {
          toast.error('Unexpected error occurred. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    };

    verifyTokenOnly();
  }, [rawTokenString, router, pathname]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);

    try {
      const response = await axiosInstance.post<{ message: string }>(
        '/verify-email',
        { email: data.email, token }
      );

      console.log('API success:', response.data);
      reset();
      toast.success('Email verified. You can sign in now.');
      router.replace('/auth/sign-in');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setApiError("Verification failed. Please check your email and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex lg:items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="flex flex-col md:w-[50%] w-full max-w-6xl bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
        <div className="w-full p-8">
          {initialCheckDone ? (
            <p className="text-center text-gray-600">Verifying token...</p>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <InputGroup
                type="email"
                label="Email"
                className="mb-4 [&_input]:py-[15px]"
                placeholder="Enter your email"
                {...register("email")}
                error={errors.email?.message}
                icon={<EmailIcon />}
              />

              <div className="mb-4.5">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary p-4 font-medium text-white transition hover:bg-opacity-90 disabled:opacity-60"
                >
                  Submit
                  {isSubmitting && (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-t-transparent" />
                  )}
                </button>
              </div>
              {apiError && <p className="text-red-500 mb-4">{apiError}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
