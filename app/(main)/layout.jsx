"use client";

import { Authenticated } from "convex/react";
import React from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useStoreUser } from "@/hooks/use-store-user";
import { BarLoader } from "react-spinners";

const MainLayout = ({ children }) => {
  return (
    <Authenticated>
      <StoredUserGate>{children}</StoredUserGate>
    </Authenticated>
  );
};

function StoredUserGate({ children }) {
  const { isLoading, isAuthenticated } = useStoreUser();

  if (isLoading || !isAuthenticated) {
    return (
      <div className="container mx-auto mt-24 mb-20 px-4">
        <div className="w-full py-12 flex justify-center">
          <BarLoader width="100%" color="#36d7b7" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="container mx-auto mt-24 mb-20 px-4">{children}</div>
      <ChatPanel />
    </>
  );
}

export default MainLayout;
