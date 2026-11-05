import type { Metadata } from "next";

import { DiagnosticStylet } from "./diagnostic";

export const metadata: Metadata = { title: "Diagnostic du stylet" };

export default function DiagnosticPage() {
  return <DiagnosticStylet />;
}
