// import React, { useEffect, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
// import axiosInstance from '@/utils/axiosInstance';
// import { AxiosError } from 'axios';
// import { PiWarningCircle } from "react-icons/pi";


export interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  email_verified_at: string;
  is_verified: boolean;
  profile_picture: string;
  account_type: string;
  institution_id: number | null;
  institution_name: string;
  designation: string;
  department: string;
  provider: string | null;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
  full_name: string;
}

export interface Quiz {
  id: number;
  title: string;
  description: string;
  category_id: number | null;
  is_published: boolean;
  open_datetime: string | null;
  close_datetime: string | null;
  quiztime_mode: boolean;
  duration: number;
  logged_in_users_only: boolean;
  safe_browser_mode: boolean;
  visibility: string;
  quiz_mode: string;
  timezone: string;
  join_link: string;
  join_code: string;
  deleted_at: string | null;
  user_id: number;
  deleted_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface QuizParticipant {
  id: number;
  quiz_id: number;
  user_id: number;
  is_anonymous: boolean;
  anonymous_details: { name?: string | null; email?: string | null } | null;
  start_time: string;
  end_time: string | null;
  score: number;
  status: string;
  created_at: string;
  updated_at: string;
  quiz: Quiz;
  user: User;
}

type props = {
  dataList: QuizParticipant[]
}

const Participants: React.FC<props> = ({ 
  dataList
}) => {
const participantsData = dataList

  return (
    <div>
      {/* {participantsData.length > 0 ?  */}
      <Table>
        <TableHeader>
          <TableRow className="border-none uppercase font-medium">
            <TableHead className="">Full Name</TableHead>
            <TableHead>Institution Name</TableHead>
            <TableHead className="">Department</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
            <TableBody>
              {participantsData?.map((channel, i) => (
                <TableRow
                  className="text-left text-base  text-dark dark:text-white"
                  key={i}
                >
                  {/* Anonymous participants have no user, only the name they joined with. */}
                  <TableCell>{channel?.user?.full_name ?? channel?.anonymous_details?.name}</TableCell>
                  <TableCell>{channel?.user?.institution_name}</TableCell>
                  <TableCell>{channel?.user?.department}</TableCell>
                  <TableCell>{channel?.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
      </Table>
      {/* //    : 
      // <div className='flex flex-col justify-center items-center py-[20px] '>
      //   <PiWarningCircle className='text-[40px] text-[#fda14d]' />
      //   <h3 className='font-bold text-[#333] pt-[5px]'> No Data Available </h3>
      // </div>} */}
    </div>
  )
}

export default Participants
