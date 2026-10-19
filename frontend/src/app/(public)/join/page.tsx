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
import { lookupSessionByCode } from "@/features/deck/api/participantApi";
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

    // v2 first: a 6-character code from the v2 alphabet is looked up with the
    // product-neutral by-code endpoint (a live Quest or Quiz session; the
    // answer names the product, kept in the join draft for the /play steps);
    // only a 404 falls through to the legacy Q/T/S prefix logic.
    if (isV2JoinCode(trimmed)) {
      const v2Code = trimmed.toUpperCase().replace(/[\s-]+/g, "");
      try {
        const session = await lookupSessionByCode(v2Code);
        saveJoinDraft(session.product, {
          product: session.product,
          sessionId: session.session_id,
          joinCode: session.join_code || v2Code,
          deckTitle: session.deck_title,
          publicChannelKey: session.public_channel_key,
        });
        // A full page load, not router.push: the participant app must start
        // without the site's analytics scripts loaded on this page.
        window.location.assign(`/play/${encodeURIComponent(v2Code)}`);
        return;
      } catch (error) {
        const deckError = toDeckApiError(error);
        if (deckError.status === 429) {
          toast.error(friendlyError(deckError, "lookup"));
          return;
        }
        // No answer at all: the server is unreachable, so the legacy lookup
        // would fail too ("Invalid code prefix" would only mislead).
        if (deckError.status === 0) {
          toast.error("Couldn't reach the server. Check your connection and try again.");
          return;
        }
        // 404 (not a live v2 session): try the legacy codes.
      }
    }

    // Legacy codes: "Q611576" for a quiz session, "T915122" for a quest. The whole code is sent
    // (the letter used to be cut off, so no code ever matched); digits alone are tried as a quiz,
    // then as a quest.
    const code = trimmed.toUpperCase().replace(/[\s-]+/g, "");
    const prefix = code.charAt(0);
    const formattedDate = moment().format("YYYY-MM-DD HH:mm:ss");
    const isDigitsOnly = /^\d+$/.test(code);

    if (prefix === "S") {
      toast.info("Survey join via code is not available yet.");
      return;
    }

    if (!["Q", "T"].includes(prefix) && !isDigitsOnly) {
      toast.error(
        isV2JoinCode(trimmed)
          ? "We couldn't find a live session with that code. Check the code and try again."
          : "Invalid code. Check the code on the host's screen and try again."
      );
      return;
    }

    const joinQuiz = async () => {
      const response = await axiosInstance.post(`/quiz-attempts-url/code`, { join_code: code, start_time: formattedDate });
      const { quiz, session } = response?.data?.data ?? {};
      // A live session joins through the live lobby; a self-paced link through its own page.
      const base = session?.is_host_live ? `/attempt/live/${session.join_code}` : `/attempt/${session.join_code}`;
      router.push(`${base}?jid=${session.join_link}&qid=${quiz.id}&sid=${session.id}`);
    };
    const joinQuest = async () => {
      const response = await axiosInstance.post(`/quest-attempts-url/join-by-code`, { join_code: code, start_time: formattedDate });
      const { quest, session } = response?.data?.data ?? {};
      router.push(`/attempt/quest-live/${quest.join_code}?jid=${quest.join_link}&qid=${quest.id}&secid=${session.id}`);
    };

    const showError = (error: unknown) => {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response) {
        // A wrong or finished code is the player's to fix, not an app error (it was logged
        // with console.error, which the dev overlay counted as an issue).
        toast.error(axiosError.response.data?.message || "We couldn't join with that code.");
      } else {
        toast.error("Couldn't reach the server. Check your connection and try again.");
      }
    };

    try {
      if (prefix === "T") await joinQuest();
      else await joinQuiz();
    } catch (error) {
      if (isDigitsOnly && (error as AxiosError).response?.status === 404) {
        try {
          await joinQuest();
          return;
        } catch {
          // Report the quiz lookup's answer below.
        }
      }
      showError(error);
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
              placeholder="Enter the code on the host's screen"
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
