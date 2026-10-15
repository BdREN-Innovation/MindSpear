"use client";
import React, { useEffect, useState } from "react";
import Image from "next/image";
import InputGroup from "@/components/FormElements/InputGroup";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import moment from "@/lib/dayjs";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { toast } from "react-toastify";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import { saveJoinDraft } from "@/features/deck/live/participantSession";
import { isV2JoinCode } from "@/features/deck-participant/lib/joinCode";
import { friendlyError } from "@/features/deck-participant/lib/errors";

function JoinPage() {
  const [currentJoinCode, setCurrentJoinCode] = useState("");
  const router = useRouter();
  const [isModalStatus, setIsModalStatus] = useState(true);

  useEffect(() => {
    setIsModalStatus(true);
  }, []);

  const handleClose = () => {
    // Close modal and return to home page
    setIsModalStatus(false);
    router.push("/");
  };

  const handleSubmit = async () => {
    const trimmed = currentJoinCode.trim();
    if (!trimmed) {
      toast.error("Please enter a join code");
      return;
    }

    // Quest v2 first: a 6-character code from the v2 alphabet is looked up
    // by-code; only a 404 falls through to the legacy Q/T/S prefix logic.
    if (isV2JoinCode(trimmed)) {
      const v2Code = trimmed.toUpperCase().replace(/[\s-]+/g, "");
      try {
        const session = await questParticipantApi.lookupByCode(v2Code);
        saveJoinDraft("quest", {
          sessionId: session.session_id,
          joinCode: session.join_code || v2Code,
          deckTitle: session.deck_title,
          publicChannelKey: session.public_channel_key,
        });
        router.push(`/play/${v2Code}`);
        return;
      } catch (error) {
        const deckError = toDeckApiError(error);
        if (deckError.status === 429) {
          toast.error(friendlyError(deckError, "lookup"));
          return;
        }
        // 404 (not a live v2 session) or a transport error: try the legacy codes.
      }
    }

    const prefix = trimmed.charAt(0).toUpperCase();
    const withoutPrefix = trimmed.length > 1 ? trimmed.slice(1) : "";
    const formattedDate = moment().format("YYYY-MM-DD HH:mm:ss");

    try {
      if (prefix === "Q") {
        if (!withoutPrefix) {
          toast.error("Invalid code. Missing code after prefix.");
          return;
        }
        const obj = { join_code: withoutPrefix, start_time: formattedDate };
        const response = await axiosInstance.post(`/quiz-attempts-url/code`, obj);
        router.push(
          `/attempt/${response?.data?.data.quiz.join_code}?jid=${response?.data?.data.quiz.join_link}&qid=${response?.data?.data.quiz.id}&aid=${response?.data?.data.attempt.id}`
        );
        return;
      }

      if (prefix === "T") {
        if (!withoutPrefix) {
          toast.error("Invalid code. Missing code after prefix.");
          return;
        }
        const questObj = {
          join_code: withoutPrefix,
          start_time: formattedDate,
          name: `${withoutPrefix}`,
        };
        const response = await axiosInstance.post(
          `/quest-attempts-url/join-by-code`,
          questObj
        );
        router.push(
          `/attempt/quest-live/${response?.data?.data?.quest?.join_code}?jid=${response?.data?.data?.quest?.join_link}&qid=${response?.data?.data?.quest?.id}&secid=${response?.data?.data?.attempt?.id}`
        );
        return;
      }

      if (prefix === "S") {
        // Not implemented in current codebase
        toast.info("Survey join via code is not available yet.");
        return;
      }

      toast.error("Invalid code prefix. Use Q..., T..., or S...");
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response) {
        console.error("Join failed:", axiosError.response.data);
        toast.error(`Error: ${axiosError.response.data?.message || "Join failed."}`);
      } else {
        console.error("Unexpected error:", axiosError.message);
        toast.error("Unexpected error occurred. Please try again.");
      }
    }
  };

  return (
    <div className="h-screen quiz_play_bg">
      <Modal title="Enter Join Code" open={isModalStatus} width={400} onClose={handleClose}>
        <div className="flex flex-col items-center">
          <Image src={"/images/logo/logo.svg"} alt="Logo" width={176} height={32} />
          <div className="bg-[#fff] p-[15px] w-full md:w-[320px] rounded-[10px] mt-[20px]">
            <InputGroup
              onChange={(e) => setCurrentJoinCode(e.target.value)}
              className="mb-3 font-bold text-[#333]"
              type="text"
              label=""
              placeholder="Enter code starting with Q / T / S"
              iconPosition="left"
              height="sm"
              value={currentJoinCode}
            />

            <button
              onClick={handleSubmit}
              className="bg-[#f49745] text-center w-full py-[10px] text-[#fff] font-bold rounded-[5px] hover:bg-[#e3893d] transition-colors"
            >
              Enter
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default JoinPage;
