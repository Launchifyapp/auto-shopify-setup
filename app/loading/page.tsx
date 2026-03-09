"use client";
export const dynamic = "force-dynamic";
import { Suspense } from "react";
import Loader from "./Loader";

export default function SuspenseBoundary() {
  return (
    <Suspense fallback={<div>Loading… / Chargement…</div>}>
      <Loader />
    </Suspense>
  );
}
