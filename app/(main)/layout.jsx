"use client";

import { Authenticated } from "convex/react";
import React from "react";
import { ChatPanel } from "@/components/chat/chat-panel";

const MainLayout = ({ children }) => {
  return (
    <Authenticated>
      <div className="container mx-auto mt-24 mb-20 px-4">{children}</div>
      <ChatPanel />
    </Authenticated>
  );
};

export default MainLayout;
