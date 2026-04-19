import { createFileRoute } from "@tanstack/react-router";
import { FosCleaner } from "@/components/FosCleaner";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "FOS Stock Report Cleaner — Blackshaws Road Pharmacy" },
      {
        name: "description",
        content:
          "Clean and reformat Z Office FOS Stock Report exports for Blackshaws Road Pharmacy. Runs entirely in your browser.",
      },
    ],
  }),
});

function Index() {
  return <FosCleaner />;
}
