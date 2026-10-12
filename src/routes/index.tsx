import { createFileRoute } from "@tanstack/react-router";
import { RealornaApp } from "@/realorna/RealornaApp";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <RealornaApp />;
}
